#!/usr/bin/env python3
"""Codegen v2: read spec/v2-endpoints.json and emit TypeScript files that drive
the n8n Holded node for every v2 resource.

Outputs (overwritten on each run):
  - nodes/Holded/v2/V2Generated.ts   one big file with:
        * V2_RESOURCE_OPTIONS  (resource selector entries)
        * v2GeneratedProperties (operations + fields for all resources)
        * V2_CATALOG  (runtime method/path/body metadata for the dispatcher)

`contactos` is excluded — it stays hand-tuned in ContactV2Description.ts to keep
the rich UX (fixedCollection bill_address/defaults, custom_fields JSON).

Operation naming
----------------
Each endpoint's `value` is derived from its Spanish slug, mapped to a stable
English verb when possible (`crear-...` → `create`, `actualizar-...` → `update`,
`listado-...` → `getAll`, `obtener-...` → `get`, `eliminar-...` → `delete`) and
falling back to a camelCased slug otherwise. Within a resource, values are made
unique by appending a counter if two slugs collapse to the same verb.

Field strategy
--------------
For each operation we emit, in display order:
  - Path parameters as required top-level fields.
  - Required body properties as top-level fields (primitives) or as JSON strings
    (objects / arrays of objects).
  - Optional body properties grouped under an "Additional Fields" collection.
  - Query parameters (excluding limit/cursor) grouped under "Filters".
  - For collection-style GETs (path has no `{id}` and method is GET) we emit
    `returnAll` + `limit`, signaling the dispatcher to use the cursor pager.

Body property type mapping:
  string + enum → options
  string + format=date → dateTime
  string         → string
  integer/number → number
  boolean        → boolean
  array<string>  → string (CSV → split by dispatcher)
  array<object>  → string (JSON parsed by dispatcher)
  object         → string (JSON parsed by dispatcher)

Field NAMES are camelCased (n8n convention); the dispatcher maps each n8n name
back to its snake_case API key via the metadata in V2_CATALOG[resource][op].
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).parent.parent
SPEC = ROOT / "spec" / "v2-endpoints.json"
OUT_DIR = ROOT / "nodes" / "Holded" / "v2"
OUT_TS = OUT_DIR / "V2Generated.ts"

EXCLUDE_RESOURCES = {"contactos"}

# Resources that also exist as a v1 resource (matched by `value`). Used to emit
# a clarifying description on the resource option so users don't assume v1 and
# v2 with the same name behave identically.
V1_VALUES = {
    "contact", "contactGroup", "document", "expenseAccount", "numberingSeries",
    "payment", "product", "remittance", "salesChannel", "service", "tax",
    "warehouse", "booking", "event", "funnel", "project", "task", "employee",
}
# Equivalent V1 resource hint for v2-only items where the concept exists under
# a different name in v1. Reported in the description so users can pick the
# right version.
V2_ONLY_HINT = {
    "accounting": "Equivalent to V1 Chart of Accounts + Daily Ledger",
    "bankAccount": "Equivalent to V1 Treasury",
    "employeeTimeTracking": "Equivalent to V1 Employee Time Tracking",
    "projectTimeTracking": "Equivalent to V1 Project Time Tracking",
    "opportunity": "Equivalent to V1 Lead",
}

# Map kebab-case Spanish resource slug → (camelCase value, English Title display name).
RESOURCE_MAP: dict[str, tuple[str, str]] = {
    "albaranes": ("deliveryNote", "Delivery Note"),
    "albaranes-de-compra": ("purchaseDeliveryNote", "Purchase Delivery Note"),
    "almacenes": ("warehouse", "Warehouse"),
    "bandeja-de-entrada": ("inbox", "Inbox"),
    "canales-de-venta": ("salesChannel", "Sales Channel"),
    "compras": ("purchase", "Purchase"),
    "contabilidad": ("accounting", "Accounting"),
    "control-de-tiempo-en-proyectos": ("projectTimeTracking", "Project Time Tracking"),
    "control-horario-de-empleados": ("employeeTimeTracking", "Employee Time Tracking"),
    "cuentas-bancarias": ("bankAccount", "Bank Account"),
    "cuentas-de-gastos": ("expenseAccount", "Expense Account"),
    "documentos": ("document", "Document"),
    "embudos": ("funnel", "Funnel"),
    "empleados": ("employee", "Employee"),
    "etiquetas": ("tag", "Tag"),
    "eventos": ("event", "Event"),
    "facturas": ("invoice", "Invoice"),
    "facturas-rectificativas": ("creditNote", "Credit Note"),
    "facturas-recurrentes": ("recurringInvoice", "Recurring Invoice"),
    "grupos-de-contactos": ("contactGroup", "Contact Group"),
    "impuestos": ("tax", "Tax"),
    "metodos-de-pago": ("paymentMethod", "Payment Method"),
    "oportunidades": ("opportunity", "Opportunity"),
    "ordenes-de-produccion": ("productionOrder", "Production Order"),
    "pagos": ("payment", "Payment"),
    "pedidos-de-compra": ("purchaseOrder", "Purchase Order"),
    "pedidos-de-venta": ("salesOrder", "Sales Order"),
    "presupuestos": ("estimate", "Estimate"),
    "previsiones-de-facturacion": ("billingForecast", "Billing Forecast"),
    "productos": ("product", "Product"),
    "proformas": ("proforma", "Proforma"),
    "proyectos": ("project", "Project"),
    "rectificativas-de-venta": ("salesCreditNote", "Sales Credit Note"),
    "registros-de-nomina": ("payrollRecord", "Payroll Record"),
    "remesas": ("remittance", "Remittance"),
    "reservas": ("booking", "Booking"),
    "series-de-numeracion": ("numberingSeries", "Numbering Series"),
    "servicios": ("service", "Service"),
    "tareas": ("task", "Task"),
    "tarifas": ("priceList", "Price List"),
    "tickets-de-venta": ("salesReceipt", "Sales Receipt"),
    "uso": ("usage", "Usage"),
}

# Atomic English verbs/adjectives that prefix operations. The walker peels them
# greedily so `bulkdeleteinvoices` becomes ["Bulk", "Delete", "Invoices"].
# Longest-first ordering ensures multi-letter verbs match before short prefixes.
ENGLISH_VERBS = sorted(
    [
        "create", "update", "delete", "list", "search", "approve", "cancel",
        "reject", "validate", "archive", "unarchive", "convert", "duplicate",
        "download", "upload", "attach", "reconcile", "record", "clockin",
        "clockout", "import", "export", "merge", "split", "stamp", "checkin",
        "checkout", "register", "unregister", "activate", "deactivate",
        "reset", "rotate", "preview", "bulk", "send", "remove", "move",
        "mark", "pay", "post", "fix", "open", "close", "lock", "unlock",
        "enable", "disable", "get", "set", "add",
    ],
    key=len,
    reverse=True,
)

# Atomic English nouns that may appear in operationIds. The walker greedily
# matches longest-first across VERBS ∪ NOUNS, so resist the urge to add
# compound forms like `purchaseorder` — keep `purchase` and `order` separate
# and the walker will split correctly. We keep mostly SINGULAR forms and let
# the post-walker glue trailing "s"/"es" suffixes onto the previous word.
ENGLISH_NOUNS = sorted(
    [
        # Documents / business objects
        "invoice", "proforma", "estimate", "creditnote", "rectification",
        "receipt", "receiptnote", "purchase", "sale", "sales", "order",
        "shipment", "shipped", "refund", "waybill", "delivery", "deliveries",
        # CRM
        "contact", "group", "opportunity", "funnel", "tag", "lead", "stage",
        "channel",
        # Catalog
        "product", "service", "warehouse", "price", "pricelist", "production",
        "stock", "image", "availability", "transit", "level", "line",
        # Accounting / treasury
        "accounting", "account", "ledger", "entry", "entries", "expense",
        "method", "bank", "banking", "movement", "remittance", "numbering",
        "series", "tax", "taxes", "treasury", "manual", "forecast", "billing",
        "recurring",
        # HR
        "employee", "payroll", "record", "salary",
        # Projects / events / bookings
        "project", "summary", "task", "event", "booking", "time", "tracking",
        "slot", "schedule", "location",
        # Documents / files
        "document", "incoming", "attachment", "file",
        # Misc nouns
        "payment", "pdf", "pipeline", "note", "info", "type", "link", "portal",
        "items", "item", "thumbnail", "main",
        "usage", "contract", "country", "keys",
    ],
    key=len,
    reverse=True,
)

# Spanish slug verb → English operation value. Slugs always start with one of
# these; everything after is contextual noise. Order matters (longest prefix).
VERB_MAP: list[tuple[str, str]] = [
    ("crear-", "create"),
    ("actualizar-", "update"),
    ("eliminar-", "delete"),
    ("listado-de-", "getAll"),
    ("listado-", "getAll"),
    ("obtener-", "get"),
    ("buscar-", "search"),
    ("aprobar-", "approve"),
    ("cancelar-", "cancel"),
    ("rechazar-", "reject"),
    ("validar-", "validate"),
    ("archivar-", "archive"),
    ("desarchivar-", "unarchive"),
    ("convertir-", "convert"),
    ("enviar-", "send"),
    ("descargar-", "download"),
    ("subir-", "upload"),
    ("adjuntar-", "attach"),
    ("anadir-", "add"),
    ("añadir-", "add"),
    ("añadir-", "add"),
    ("quitar-", "remove"),
    ("mover-", "move"),
    ("duplicar-", "duplicate"),
    ("fichar-", "clockIn"),
    ("registrar-", "record"),
    ("marcar-", "mark"),
    ("pagar-", "pay"),
    ("conciliar-", "reconcile"),
]


def to_camel(s: str) -> str:
    """kebab/snake → camelCase. Preserve already-camelCase single-token inputs."""
    parts = re.split(r"[-_\s]+", s)
    parts = [p for p in parts if p]
    if not parts:
        return ""
    if len(parts) == 1:
        return parts[0][:1].lower() + parts[0][1:]
    return parts[0].lower() + "".join(p[:1].upper() + p[1:].lower() for p in parts[1:])


UPPER_ACRONYMS = {"pdf": "PDF", "id": "ID", "url": "URL", "vat": "VAT"}


def to_title(s: str) -> str:
    """kebab/snake/camelCase → Title Case (display), with acronym fixups.

    Splits on separators AND camelCase boundaries so an already-camelCase
    api key like `employeeId` becomes "Employee ID" rather than "Employeeid".
    """
    parts = re.split(r"[-_\s]+|(?<=[a-z0-9])(?=[A-Z])", s)
    out: list[str] = []
    for p in parts:
        if not p:
            continue
        out.append(UPPER_ACRONYMS.get(p.lower(), p[:1].upper() + p[1:].lower()))
    return " ".join(out)


OPERATIONID_RE = re.compile(r"http_api_(.*?)__invoke")


def english_words_from_operationid(operation_id: str) -> list[str]:
    """Parse the operationId English fragment into a list of capitalized words.

    Holded operationIds embed an English identifier between `_http_api_` and
    `__invoke`, e.g. `getinvoiceattachmentapi`. We strip the trailing `api`,
    de-duplicate doubled forms like `bulkdeleteinvoices_bulkdeleteinvoices`,
    then greedily peel known verbs and nouns from the left to recover word
    boundaries.
    """
    m = OPERATIONID_RE.search(operation_id or "")
    if not m:
        return []
    raw = m.group(1)
    # Strip trailing 'api'
    if raw.endswith("api"):
        raw = raw[:-3]
    # Some IDs are `xxx_xxx` (identical halves); take first half.
    if "_" in raw:
        parts = raw.split("_")
        if len(parts) >= 2 and parts[0] == parts[1]:
            raw = parts[0]
        else:
            # Holded operationIds are `<category>_<subresource>_<verbnoun>`,
            # e.g. `team_employee_getemployee`. The meaningful op is the LAST
            # segment; taking parts[0] mislabels every such op after the
            # category ("Team", "Crm", "Projects"…).
            raw = parts[-1]
    raw = raw.lower()

    vocabulary = sorted(set(ENGLISH_VERBS) | set(ENGLISH_NOUNS), key=len, reverse=True)
    out: list[str] = []
    i = 0
    while i < len(raw):
        matched = False
        for word in vocabulary:
            if raw.startswith(word, i):
                out.append(word[:1].upper() + word[1:])
                i += len(word)
                matched = True
                break
        if not matched:
            j = i + 1
            while j < len(raw) and not any(raw.startswith(w, j) for w in vocabulary):
                j += 1
            chunk = raw[i:j]
            if chunk:
                out.append(chunk[:1].upper() + chunk[1:])
            i = j

    # Glue trailing short plural suffix ("S", "Es") onto the previous word so
    # the walker can keep only singular nouns in vocabulary and still emit
    # plurals correctly (`Product` + `S` → `Products`).
    fixed: list[str] = []
    for w in out:
        if fixed and w in {"S", "Es"}:
            fixed[-1] = fixed[-1] + w.lower()
        else:
            fixed.append(w)
    return fixed


# Single-token verbs the walker emits glued together but which read better as
# two words in display/action labels. The op VALUE keeps the glued camelCase.
WORD_DISPLAY = {"clockin": "Clock In", "clockout": "Clock Out", "checkin": "Check In"}


def english_display_from_endpoint(ep: dict) -> str:
    """Pretty English title for an endpoint, derived from operationId.

    Examples:
        getinvoiceapi          → "Get Invoice"
        getinvoiceattachmentapi → "Get Invoice Attachment"
        bulkdeleteinvoices     → "Bulk Delete Invoices"
    """
    words = english_words_from_operationid(ep.get("operationId") or "")
    if not words:
        return ep.get("slug") or ""
    return " ".join(
        WORD_DISPLAY.get(w.lower(), UPPER_ACRONYMS.get(w.lower(), w)) for w in words
    )


def english_op_value_from_endpoint(ep: dict, resource_value: str) -> str:
    """Compute a stable English camelCase operation value derived from operationId.

    Strips the resource name (which is implicit via the selector) so
    `getinvoice` for resource=invoice becomes simply `get`.
    """
    words = english_words_from_operationid(ep.get("operationId") or "")
    if not words:
        return op_value_from_slug(ep.get("slug") or "")

    # Collapse PascalCase words to lowercase for matching.
    lowered = [w.lower() for w in words]

    # Drop the trailing resource noun(s) when redundant so a multi-word
    # resource like "Sales Order" collapses `createSalesOrder` to `create`.
    # Tokenize the camelCase resource value into lowercase words and try to
    # peel the matching tail from `lowered`.
    res_tokens = [t for t in re.split(r"(?=[A-Z])", resource_value) if t]
    res_tokens_lower = [t.lower() for t in res_tokens]
    if res_tokens_lower:
        last = res_tokens_lower[-1]
        plural_alts = {last, last + "s", last + "es", last.rstrip("s")}
        if (
            len(lowered) >= len(res_tokens_lower)
            and lowered[-len(res_tokens_lower):-1] == res_tokens_lower[:-1]
            and lowered[-1] in plural_alts
        ):
            for _ in res_tokens_lower:
                lowered.pop()
                words.pop()

    if not words:
        # All words were the resource → just use the HTTP verb fallback from slug
        return op_value_from_slug(ep.get("slug") or "")

    # CamelCase join
    first = words[0][:1].lower() + words[0][1:]
    return first + "".join(w[:1].upper() + w[1:] for w in words[1:])


def op_value_from_slug(slug: str) -> str:
    base = slug.lower()
    for prefix, verb in VERB_MAP:
        if base.startswith(prefix):
            tail = base[len(prefix):]
            if verb in {"create", "update", "delete", "getAll", "get", "search"}:
                # Standard CRUD verbs: usually the operation IS the verb only.
                return verb
            tail_camel = to_camel(tail)
            if not tail_camel:
                return verb
            return verb + tail_camel[:1].upper() + tail_camel[1:]
    return to_camel(base)


def is_collection_get(ep: dict) -> bool:
    if (ep.get("method") or "").lower() != "get":
        return False
    path = ep.get("path") or ""
    return not path.rstrip("/").endswith("}")


def kept_query_params(ep: dict) -> list[dict]:
    params = ep.get("parameters") or []
    out = []
    for p in params:
        if (p.get("in") or "") != "query":
            continue
        name = p.get("name") or ""
        # Pagination is handled by the dispatcher.
        if name in {"cursor", "limit"}:
            continue
        out.append(p)
    return out


def path_params(ep: dict) -> list[dict]:
    return [p for p in (ep.get("parameters") or []) if (p.get("in") or "") == "path"]


def js_string(s: str | None) -> str:
    """Emit a JS-safe single-quoted string. Falls back to '' for None."""
    if s is None:
        s = ""
    s = s.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n").replace("\r", "")
    return f"'{s}'"


def short(desc: str | None, limit: int = 240) -> str:
    if not desc:
        return ""
    desc = re.sub(r"\s+", " ", desc).strip()
    if len(desc) > limit:
        desc = desc[: limit - 1] + "…"
    return desc


# ---------- Field emission ---------------------------------------------------


def map_body_prop_type(prop: dict) -> tuple[str, dict]:
    """Return (n8n field type, extra props) given a JSON Schema property."""
    t = prop.get("type")
    fmt = prop.get("format")
    enum = prop.get("enum")
    extra: dict[str, Any] = {}
    if enum and t == "string":
        extra["options"] = [{"name": to_title(str(v)), "value": str(v)} for v in enum]
        return "options", extra
    if fmt == "date" or fmt == "date-time":
        return "dateTime", extra
    if t == "string":
        return "string", extra
    if t in ("integer", "number"):
        return "number", extra
    if t == "boolean":
        return "boolean", extra
    if t == "array":
        items = prop.get("items") or {}
        if items.get("type") == "string":
            extra["_jsonHint"] = "csv"
            return "string", extra
        extra["_jsonHint"] = "json"
        return "string", extra
    # object or unknown → JSON string
    extra["_jsonHint"] = "json"
    return "string", extra


def emit_field(
    *,
    api_key: str,
    n8n_name: str,
    display: str,
    desc: str,
    field_type: str,
    extra: dict,
    required: bool,
    show_filters: dict[str, list[str]],
) -> str:
    """Emit one INodeProperties entry as TS source."""
    parts: list[str] = []
    parts.append(f"\t\tdisplayName: {js_string(display)},")
    parts.append(f"\t\tname: {js_string(n8n_name)},")
    parts.append(f"\t\ttype: {js_string(field_type)},")
    if field_type == "options":
        opts = extra.get("options") or []
        parts.append("\t\toptions: [")
        for o in opts:
            parts.append(
                f"\t\t\t{{ name: {js_string(o['name'])}, value: {js_string(str(o['value']))} }},"
            )
        parts.append("\t\t],")
        # default = first value
        default_val = js_string(str(opts[0]["value"])) if opts else "''"
        parts.append(f"\t\tdefault: {default_val},")
    elif field_type == "boolean":
        parts.append("\t\tdefault: false,")
    elif field_type == "number":
        parts.append("\t\tdefault: 0,")
    else:  # string, dateTime
        parts.append("\t\tdefault: '',")
    if required:
        parts.append("\t\trequired: true,")
    # Skip Spanish description from the upstream API docs; emit only the
    # JSON/CSV hint when applicable so the input format is unambiguous.
    hint = extra.get("_jsonHint")
    if hint == "json":
        parts.append(f"\t\tdescription: {js_string('Send as JSON.')},")
    elif hint == "csv":
        parts.append(f"\t\tdescription: {js_string('Comma-separated.')},")
    show_lines = ["\t\tdisplayOptions: {", "\t\t\tshow: {"]
    for k, v in show_filters.items():
        show_lines.append(f"\t\t\t\t{k}: [{', '.join(js_string(x) for x in v)}],")
    show_lines += ["\t\t\t},", "\t\t},"]
    return "\t{\n" + "\n".join(parts + show_lines) + "\n\t}"


def emit_collection(
    *,
    name: str,
    display: str,
    children_src: list[str],
    show_filters: dict[str, list[str]],
) -> str:
    inner = ",\n".join("\t\t\t" + c.replace("\n", "\n\t\t\t") for c in children_src)
    show_lines = ["\t\tdisplayOptions: {", "\t\t\tshow: {"]
    for k, v in show_filters.items():
        show_lines.append(f"\t\t\t\t{k}: [{', '.join(js_string(x) for x in v)}],")
    show_lines += ["\t\t\t},", "\t\t},"]
    return (
        "\t{\n"
        f"\t\tdisplayName: {js_string(display)},\n"
        f"\t\tname: {js_string(name)},\n"
        "\t\ttype: 'collection',\n"
        f"\t\tplaceholder: 'Add Field',\n"
        "\t\tdefault: {},\n"
        + "\n".join(show_lines)
        + f"\n\t\toptions: [\n{inner}\n\t\t],\n"
        "\t}"
    )


# ---------- Per-resource emission --------------------------------------------


def emit_resource(
    resource_slug: str,
    resource_value: str,
    resource_title: str,
    endpoints: list[dict],
) -> tuple[list[str], dict[str, dict]]:
    """Return (TS source chunks for this resource, catalog entry).

    Catalog entry shape:
      {
        operation: {
          method, path,
          pathParams: [<n8n-name>, ...],
          queryMap: { <n8n-name>: <api-key> },
          bodyMap:  { <n8n-name>: <api-key> },
          bodyJsonKeys: [<n8n-name>, ...]   # parse JSON before sending
          bodyCsvKeys:  [<n8n-name>, ...]   # split CSV before sending
          collectionGet: bool
        }
      }
    """
    op_values_used: set[str] = set()
    ops_emitted: list[dict] = []
    catalog: dict[str, dict] = {}
    field_chunks: list[str] = []

    # Stable operation order: create, get, getAll, update, delete, then rest alpha by op value.
    preferred = ["create", "get", "getAll", "update", "delete", "search"]
    ordered: list[tuple[str, dict]] = []
    for ep in endpoints:
        op = english_op_value_from_endpoint(ep, resource_value)
        # Map common synonyms to canonical CRUD values.
        method_l = (ep.get("method") or "").lower()
        if method_l == "get" and op in {"list", "listAll", "getAll"}:
            op = "getAll"
        if method_l == "post" and op in {"newOne", "add"}:
            op = "create"
        # Deduplicate
        original_op = op
        counter = 2
        while op in op_values_used:
            op = f"{original_op}{counter}"
            counter += 1
        op_values_used.add(op)
        ordered.append((op, ep))

    def sort_key(t: tuple[str, dict]):
        op = t[0]
        return (preferred.index(op) if op in preferred else 100, op)

    ordered.sort(key=sort_key)

    # 1. Operations selector — names in English derived from operationId.
    op_options_src = []
    for op, ep in ordered:
        name = english_display_from_endpoint(ep) or to_title(op)
        action_label = name
        method = (ep.get("method") or "GET").upper()
        block = (
            "\t\t\t{\n"
            f"\t\t\t\tname: {js_string(name)},\n"
            f"\t\t\t\tvalue: {js_string(op)},\n"
            f"\t\t\t\taction: {js_string(action_label)},\n"
            "\t\t\t},"
        )
        op_options_src.append(block)
        ops_emitted.append({"op": op, "ep": ep, "method": method})

    operations_block = (
        "\t{\n"
        "\t\tdisplayName: 'Operation',\n"
        "\t\tname: 'operation',\n"
        "\t\ttype: 'options',\n"
        "\t\tnoDataExpression: true,\n"
        "\t\tdisplayOptions: {\n"
        "\t\t\tshow: {\n"
        f"\t\t\t\tresource: [{js_string(resource_value)}],\n"
        "\t\t\t},\n"
        "\t\t},\n"
        "\t\toptions: [\n"
        + "\n".join(op_options_src)
        + "\n\t\t],\n"
        f"\t\tdefault: {js_string(ordered[0][0])},\n"
        "\t}"
    )
    field_chunks.append(operations_block)

    # 2. For each operation: fields
    for op, ep, method in [(d["op"], d["ep"], d["method"]) for d in ops_emitted]:
        show = {"resource": [resource_value], "operation": [op]}
        path = ep.get("path") or ""
        # A GET whose path has no `{id}` is treated as a cursor-paginated
        # collection. Some object-returning GETs (e.g. /usage, /taxes/
        # keys-by-country, /employees/{id}/contract) are NOT paginated lists,
        # so allow the spec to override via `x_collection: false`.
        coll_get = ep.get("x_collection")
        if coll_get is None:
            coll_get = is_collection_get(ep)

        cat: dict[str, Any] = {
            "method": method,
            "path": path,
            "pathParams": [],
            "queryMap": {},
            "bodyMap": {},
            "bodyJsonKeys": [],
            "bodyCsvKeys": [],
            "collectionGet": coll_get,
        }

        # 2a. Path params (always required, top-level)
        for p in path_params(ep):
            api_key = p.get("name") or ""
            n8n_name = to_camel(api_key) or api_key
            display = to_title(api_key)
            desc = short(p.get("description") or "", 200) or f"Identifier ({api_key})"
            field_chunks.append(
                emit_field(
                    api_key=api_key,
                    n8n_name=n8n_name,
                    display=display,
                    desc=desc,
                    field_type="string",
                    extra={},
                    required=True,
                    show_filters=show,
                )
            )
            cat["pathParams"].append({"name": n8n_name, "key": api_key})

        # 2b. Body schema split into required/optional
        rb = ep.get("requestBody") or {}
        schema = rb.get("schema") or {}
        props: dict = schema.get("properties") or {}
        required_keys = set(schema.get("required") or [])

        required_fields_src: list[str] = []
        optional_fields_src: list[str] = []
        for api_key, sub in props.items():
            sub = sub or {}
            field_type, extra = map_body_prop_type(sub)
            n8n_name = to_camel(api_key) or api_key
            display = to_title(api_key)
            desc = short(sub.get("description") or "", 220)
            example = sub.get("example")
            if example is not None and isinstance(example, (str, int, float, bool)):
                desc = (desc + " " if desc else "") + f"Example: {example}"
            chunk = emit_field(
                api_key=api_key,
                n8n_name=n8n_name,
                display=display,
                desc=desc,
                field_type=field_type,
                extra=extra,
                required=api_key in required_keys,
                show_filters=show,
            )
            if api_key in required_keys:
                required_fields_src.append(chunk)
            else:
                # Inside a collection: strip displayOptions on the inner field
                chunk_inner = re.sub(
                    r",\n\t\tdisplayOptions: \{[\s\S]*?\n\t\t\},",
                    "",
                    chunk,
                )
                optional_fields_src.append(chunk_inner)
            cat["bodyMap"][n8n_name] = api_key
            hint = extra.get("_jsonHint")
            if hint == "json":
                cat["bodyJsonKeys"].append(n8n_name)
            elif hint == "csv":
                cat["bodyCsvKeys"].append(n8n_name)

        field_chunks.extend(required_fields_src)
        if optional_fields_src:
            field_chunks.append(
                emit_collection(
                    name="additionalFields",
                    display="Additional Fields",
                    children_src=optional_fields_src,
                    show_filters=show,
                )
            )

        # 2c. Query params
        qparams = kept_query_params(ep)
        if qparams:
            q_inner: list[str] = []
            for p in qparams:
                api_key = p.get("name") or ""
                n8n_name = to_camel(api_key) or api_key
                sub_schema = {
                    "type": p.get("type") or "string",
                    "format": p.get("format"),
                    "enum": p.get("enum"),
                }
                field_type, extra = map_body_prop_type(sub_schema)
                desc = short(p.get("description") or "", 220)
                chunk = emit_field(
                    api_key=api_key,
                    n8n_name=n8n_name,
                    display=to_title(api_key),
                    desc=desc,
                    field_type=field_type,
                    extra=extra,
                    required=False,
                    show_filters=show,
                )
                chunk_inner = re.sub(
                    r",\n\t\tdisplayOptions: \{[\s\S]*?\n\t\t\},",
                    "",
                    chunk,
                )
                q_inner.append(chunk_inner)
                cat["queryMap"][n8n_name] = api_key
            field_chunks.append(
                emit_collection(
                    name="filters",
                    display="Filters",
                    children_src=q_inner,
                    show_filters=show,
                )
            )

        # 2d. Pagination controls for collection GETs
        if coll_get:
            field_chunks.append(
                emit_collection(  # not really, we want top-level boolean+number
                    name="paginationFiller_unused",
                    display="Pagination",
                    children_src=[],
                    show_filters=show,
                )
            )
            # Replace last entry with the proper pair
            field_chunks.pop()
            return_all = (
                "\t{\n"
                "\t\tdisplayName: 'Return All',\n"
                "\t\tname: 'returnAll',\n"
                "\t\ttype: 'boolean',\n"
                "\t\tdefault: false,\n"
                "\t\tdescription: 'Whether to return all results or only up to a given limit',\n"
                "\t\tdisplayOptions: {\n"
                "\t\t\tshow: {\n"
                f"\t\t\t\tresource: [{js_string(resource_value)}],\n"
                f"\t\t\t\toperation: [{js_string(op)}],\n"
                "\t\t\t},\n"
                "\t\t},\n"
                "\t}"
            )
            limit = (
                "\t{\n"
                "\t\tdisplayName: 'Limit',\n"
                "\t\tname: 'limit',\n"
                "\t\ttype: 'number',\n"
                "\t\ttypeOptions: { minValue: 1 },\n"
                "\t\tdefault: 50,\n"
                "\t\tdescription: 'Max number of results to return',\n"
                "\t\tdisplayOptions: {\n"
                "\t\t\tshow: {\n"
                f"\t\t\t\tresource: [{js_string(resource_value)}],\n"
                f"\t\t\t\toperation: [{js_string(op)}],\n"
                "\t\t\t\treturnAll: [false],\n"
                "\t\t\t},\n"
                "\t\t},\n"
                "\t}"
            )
            field_chunks.append(return_all)
            field_chunks.append(limit)

        catalog[op] = cat

    return field_chunks, catalog


# ---------- Top-level emission ------------------------------------------------


def main() -> None:
    data = json.loads(SPEC.read_text())
    endpoints = data["endpoints"]

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    resource_options: list[tuple[str, str, str]] = []  # (slug, value, title)
    catalogs: dict[str, dict] = {}
    all_field_chunks: list[str] = []

    # Resources sorted by English title for the selector UX.
    for slug in sorted(endpoints):
        if slug in EXCLUDE_RESOURCES:
            continue
        if slug not in RESOURCE_MAP:
            print(f"WARNING: no display mapping for resource {slug}, skipping", file=sys.stderr)
            continue
        value, title = RESOURCE_MAP[slug]
        resource_options.append((slug, value, title))

    resource_options.sort(key=lambda t: t[2])

    for slug, value, title in resource_options:
        chunks, cat = emit_resource(slug, value, title, endpoints[slug])
        catalogs[value] = cat
        all_field_chunks.extend(chunks)

    # Resource selector options. Each gets a description indicating whether
    sel_options = ",\n".join(
        "\t{ name: " + js_string(title) + ", value: " + js_string(value) + " }"
        for _slug, value, title in resource_options
    )

    # Catalog literal (TS)
    def emit_cat(cat: dict) -> str:
        body = json.dumps(cat, indent=2, ensure_ascii=False)
        return body

    cat_literal = "{\n" + ",\n".join(
        f"\t{js_string(res_val)}: " + emit_cat(res_cat).replace("\n", "\n\t")
        for res_val, res_cat in catalogs.items()
    ) + "\n}"

    header = (
        "/* eslint-disable */\n"
        "// AUTO-GENERATED by spec/gen-v2.py from spec/v2-endpoints.json.\n"
        "// Do not edit by hand — regenerate with `python3 spec/gen-v2.py`.\n\n"
        "import type { INodeProperties } from 'n8n-workflow';\n\n"
    )

    res_opts_block = (
        "export const V2_RESOURCE_OPTIONS: Array<{ name: string; value: string }> = [\n"
        + sel_options
        + ",\n];\n\n"
    )

    catalog_block = (
        "export interface V2EndpointMeta {\n"
        "\tmethod: string;\n"
        "\tpath: string;\n"
        "\tpathParams: Array<{ name: string; key: string }>;\n"
        "\tqueryMap: Record<string, string>;\n"
        "\tbodyMap: Record<string, string>;\n"
        "\tbodyJsonKeys: string[];\n"
        "\tbodyCsvKeys: string[];\n"
        "\tcollectionGet: boolean;\n"
        "}\n\n"
        "export const V2_CATALOG: Record<string, Record<string, V2EndpointMeta>> = "
        + cat_literal
        + ";\n\n"
    )

    properties_block = (
        "export const v2GeneratedProperties: INodeProperties[] = [\n"
        + ",\n".join(all_field_chunks)
        + ",\n];\n"
    )

    OUT_TS.write_text(header + res_opts_block + catalog_block + properties_block)
    print(f"Wrote {OUT_TS}", file=sys.stderr)
    print(
        f"  resources: {len(resource_options)} | total ops: {sum(len(c) for c in catalogs.values())}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
