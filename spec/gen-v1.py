#!/usr/bin/env python3
"""Codegen v1: produce TS for the legacy Holded v1 API (136 endpoints across
5 areas, 24 groups).

Output:
  - nodes/Holded/v1/V1Generated.ts with V1_RESOURCE_OPTIONS, V1_CATALOG,
    v1GeneratedProperties.

Each "resource" in the n8n selector corresponds to a v1 group (e.g.
`contacts` from the invoice-api area maps to resource value `contactV1` with
display "Contact" — version suffix in the catalog metadata, not the visible
name, because the API Version selector at the top already disambiguates).

`contact` (invoice-api/contacts) is excluded — the hand-tuned
ContactDescription.ts retains the existing legacy contact CRUD ops.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).parent.parent
SPEC = ROOT / "spec" / "v1-endpoints.json"
OUT_DIR = ROOT / "nodes" / "Holded" / "v1"
OUT_TS = OUT_DIR / "V1Generated.ts"

# (area, group-slug) → (camelCase value, English Title) used by the resource
# selector. Same `contact` slug exists in v1 invoicing too, so we suffix the
# value to avoid colliding with the v2 selector / hand-tuned v1 Contact.
RESOURCE_MAP: dict[tuple[str, str], tuple[str, str]] = {
    ("invoice-api", "contacts"): ("contact", "Contact"),  # collides with hand-tuned
    ("invoice-api", "contact-groups"): ("contactGroup", "Contact Group"),
    ("invoice-api", "documents"): ("document", "Document"),
    ("invoice-api", "expenses-accounts"): ("expenseAccount", "Expense Account"),
    ("invoice-api", "numbering-series"): ("numberingSeries", "Numbering Series"),
    ("invoice-api", "payments"): ("payment", "Payment"),
    ("invoice-api", "products"): ("product", "Product"),
    ("invoice-api", "remittances"): ("remittance", "Remittance"),
    ("invoice-api", "sales-channels"): ("salesChannel", "Sales Channel"),
    ("invoice-api", "services"): ("service", "Service"),
    ("invoice-api", "taxes"): ("tax", "Tax"),
    ("invoice-api", "treasuries"): ("treasury", "Treasury Account"),
    ("invoice-api", "warehouses"): ("warehouse", "Warehouse"),
    ("crm-api", "bookings"): ("booking", "Booking"),
    ("crm-api", "events"): ("event", "Event"),
    ("crm-api", "funnels"): ("funnel", "Funnel"),
    ("crm-api", "leads"): ("lead", "Lead"),
    ("projects-api", "projects"): ("project", "Project"),
    ("projects-api", "tasks"): ("task", "Task"),
    ("projects-api", "time-tracking"): ("projectTime", "Project Time Tracking"),
    ("team-api", "employees"): ("employee", "Employee"),
    ("team-api", "employees-time-tracking"): ("employeeTime", "Employee Time Tracking"),
    ("accounting-api", "chart-of-accounts"): ("chartOfAccounts", "Chart of Accounts"),
    ("accounting-api", "daily-ledger"): ("dailyLedger", "Daily Ledger"),
}

# `contact` is hand-tuned in ContactDescription.ts (v1 legacy CRUD). Skip it in
# codegen so we don't double-emit operations for the same resource.
EXCLUDE_RESOURCES = {("invoice-api", "contacts")}

# Resources that also exist in v2 (matched by `value`).
V2_VALUES = {
    "contact", "contactGroup", "document", "expenseAccount", "numberingSeries",
    "payment", "product", "remittance", "salesChannel", "service", "tax",
    "warehouse", "booking", "event", "funnel", "project", "task", "employee",
}
# Equivalent V2 resource hint for v1-only items where the concept exists under
# a different name in v2.
V1_ONLY_HINT = {
    "treasury": "Equivalent to V2 Bank Account",
    "chartOfAccounts": "Equivalent to V2 Accounting",
    "dailyLedger": "Equivalent to V2 Accounting (ledger entries)",
    "lead": "Equivalent to V2 Opportunity",
    "projectTime": "Equivalent to V2 Project Time Tracking",
    "employeeTime": "Equivalent to V2 Employee Time Tracking",
}


def to_camel(s: str) -> str:
    parts = re.split(r"[-_\s]+", s)
    parts = [p for p in parts if p]
    if not parts:
        return ""
    if len(parts) == 1:
        return parts[0][:1].lower() + parts[0][1:]
    return parts[0].lower() + "".join(p[:1].upper() + p[1:].lower() for p in parts[1:])


def to_title(s: str) -> str:
    parts = re.split(r"[-_\s]+", s)
    return " ".join(p[:1].upper() + p[1:].lower() for p in parts if p)


PREFERRED_OPS = {
    "create": 0, "get": 1, "list": 2, "update": 3, "delete": 4,
}

VERBS_TO_CANONICAL: dict[str, str] = {
    "create": "create",
    "get": "get",
    "list": "getAll",
    "listall": "getAll",
    "delete": "delete",
    "update": "update",
    "search": "search",
}


def op_from_slug(slug: str) -> str:
    """Map a v1 slug to a stable operation value.

    Handles both hyphenated forms like `list-contacts` and concatenated forms
    like `listemployees` (the team-api section omits separators). For both we
    peel a known verb prefix then collapse standard CRUD verbs to their bare
    canonical value, dropping the trailing resource words that the selector
    already conveys.
    """
    base = slug.lower()
    parts = base.split("-")
    if "-" not in base:
        # Try to identify a known verb at the start (longest match)
        verbs_sorted = sorted(VERBS_TO_CANONICAL, key=len, reverse=True)
        for v in verbs_sorted:
            if base.startswith(v):
                tail = base[len(v):]
                verb = VERBS_TO_CANONICAL[v]
                if not tail or verb in {"create", "get", "getAll", "delete", "update", "search"}:
                    return verb
                return verb + tail[:1].upper() + tail[1:]
        return to_camel(slug)

    head = parts[0]
    if head in VERBS_TO_CANONICAL:
        verb = VERBS_TO_CANONICAL[head]
        tail = parts[1:]
        if not tail:
            return verb
        if verb in {"create", "get", "getAll", "delete", "update", "search"}:
            return verb
        return verb + "".join(p[:1].upper() + p[1:].lower() for p in tail)
    return to_camel(slug)


def english_display(slug: str, title: str | None) -> str:
    if title:
        # Title case, preserve acronyms
        t = re.sub(r"\s+", " ", title).strip()
        return t
    return to_title(slug.replace("-", " "))


def js_string(s: str | None) -> str:
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


# ---------- Field type mapping (v1 body schema is flat) ----------------------


def map_body_field_type(field: dict) -> tuple[str, dict]:
    t = (field.get("type") or "string").lower()
    enum = field.get("enumValues") or []
    extra: dict[str, Any] = {}
    if enum:
        extra["options"] = [
            {"name": to_title(str(v)), "value": str(v)} for v in enum
        ]
        return "options", extra
    if t in ("integer", "number"):
        return "number", extra
    if t == "boolean":
        return "boolean", extra
    if t == "array":
        extra["_jsonHint"] = "csv"
        return "string", extra
    if t == "object":
        extra["_jsonHint"] = "json"
        return "string", extra
    return "string", extra


def emit_field(
    *,
    n8n_name: str,
    display: str,
    field_type: str,
    extra: dict,
    required: bool,
    show: dict[str, list[str]],
) -> str:
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
        default_val = js_string(str(opts[0]["value"])) if opts else "''"
        parts.append(f"\t\tdefault: {default_val},")
    elif field_type == "boolean":
        parts.append("\t\tdefault: false,")
    elif field_type == "number":
        parts.append("\t\tdefault: 0,")
    else:
        parts.append("\t\tdefault: '',")
    if required:
        parts.append("\t\trequired: true,")
    hint = extra.get("_jsonHint")
    if hint == "json":
        parts.append(f"\t\tdescription: {js_string('Send as JSON.')},")
    elif hint == "csv":
        parts.append(f"\t\tdescription: {js_string('Comma-separated.')},")
    show_lines = ["\t\tdisplayOptions: {", "\t\t\tshow: {"]
    for k, v in show.items():
        show_lines.append(f"\t\t\t\t{k}: [{', '.join(js_string(x) for x in v)}],")
    show_lines += ["\t\t\t},", "\t\t},"]
    return "\t{\n" + "\n".join(parts + show_lines) + "\n\t}"


def emit_collection(
    *, name: str, display: str, children_src: list[str], show: dict[str, list[str]]
) -> str:
    inner = ",\n".join("\t\t\t" + c.replace("\n", "\n\t\t\t") for c in children_src)
    show_lines = ["\t\tdisplayOptions: {", "\t\t\tshow: {"]
    for k, v in show.items():
        show_lines.append(f"\t\t\t\t{k}: [{', '.join(js_string(x) for x in v)}],")
    show_lines += ["\t\t\t},", "\t\t},"]
    return (
        "\t{\n"
        f"\t\tdisplayName: {js_string(display)},\n"
        f"\t\tname: {js_string(name)},\n"
        "\t\ttype: 'collection',\n"
        "\t\tplaceholder: 'Add Field',\n"
        "\t\tdefault: {},\n"
        + "\n".join(show_lines)
        + f"\n\t\toptions: [\n{inner}\n\t\t],\n"
        "\t}"
    )


# ---------- Per-resource emission --------------------------------------------


def is_collection_get(ep: dict) -> bool:
    if (ep.get("method") or "").upper() != "GET":
        return False
    path = ep.get("path") or ""
    return not path.rstrip("/").endswith("}")


def emit_resource(
    area_slug: str,
    group_slug: str,
    resource_value: str,
    resource_title: str,
    area_base_path: str,
    endpoints: list[dict],
) -> tuple[list[str], dict[str, dict]]:
    op_values_used: set[str] = set()
    catalog: dict[str, dict] = {}
    field_chunks: list[str] = []

    ordered: list[tuple[str, dict]] = []
    for ep in endpoints:
        op = op_from_slug(ep.get("slug") or "")
        # Dedup
        original_op = op
        counter = 2
        while op in op_values_used:
            op = f"{original_op}{counter}"
            counter += 1
        op_values_used.add(op)
        ordered.append((op, ep))

    def sort_key(t: tuple[str, dict]):
        op = t[0]
        return (PREFERRED_OPS.get(op, 100), op)

    ordered.sort(key=sort_key)

    # Operations selector — `action` carries a (V1) suffix so the global
    # Actions search panel disambiguates v1 vs v2 entries that share names.
    op_options_src = []
    for op, ep in ordered:
        name = english_display(ep.get("slug") or "", ep.get("title"))
        action_label = f"{name} (V1)"
        block = (
            "\t\t\t{\n"
            f"\t\t\t\tname: {js_string(name)},\n"
            f"\t\t\t\tvalue: {js_string(op)},\n"
            f"\t\t\t\taction: {js_string(action_label)},\n"
            "\t\t\t},"
        )
        op_options_src.append(block)

    operations_block = (
        "\t{\n"
        "\t\tdisplayName: 'Operation',\n"
        "\t\tname: 'operation',\n"
        "\t\ttype: 'options',\n"
        "\t\tnoDataExpression: true,\n"
        "\t\tdisplayOptions: {\n"
        "\t\t\tshow: {\n"
        "\t\t\t\tapiVersion: ['v1'],\n"
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

    # For each op: emit fields + catalog entry
    for op, ep in ordered:
        show = {"apiVersion": ["v1"], "resource": [resource_value], "operation": [op]}
        method = (ep.get("method") or "GET").upper()
        path = ep.get("path") or ""
        full_path = area_base_path + path
        coll_get = is_collection_get(ep)

        cat: dict[str, Any] = {
            "method": method,
            "path": full_path,
            "pathParams": [],
            "queryMap": {},
            "bodyMap": {},
            "bodyJsonKeys": [],
            "bodyCsvKeys": [],
            "collectionGet": coll_get,
        }

        # Path params from `parameters` where in=path
        for p in ep.get("parameters") or []:
            if p.get("in") != "path":
                continue
            api_key = p.get("name") or ""
            n8n_name = to_camel(api_key)
            display = to_title(api_key)
            field_chunks.append(
                emit_field(
                    n8n_name=n8n_name,
                    display=display,
                    field_type="string",
                    extra={},
                    required=True,
                    show=show,
                )
            )
            cat["pathParams"].append({"name": n8n_name, "key": api_key})

        # Body schema (flat fields)
        body_schema = ep.get("request_body_schema") or []
        required_fields_src: list[str] = []
        optional_fields_src: list[str] = []
        for f in body_schema:
            api_key = f.get("name") or ""
            n8n_name = to_camel(api_key) or api_key
            field_type, extra = map_body_field_type(f)
            chunk = emit_field(
                n8n_name=n8n_name,
                display=to_title(api_key),
                field_type=field_type,
                extra=extra,
                required=bool(f.get("required")),
                show=show,
            )
            if f.get("required"):
                required_fields_src.append(chunk)
            else:
                chunk_inner = re.sub(
                    r",\n\t\tdisplayOptions: \{[\s\S]*?\n\t\t\},", "", chunk,
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
                    show=show,
                )
            )

        # Query params → filters collection
        qparams = [p for p in (ep.get("parameters") or []) if p.get("in") == "query"]
        # Drop pagination params; the dispatcher handles them.
        qparams = [p for p in qparams if (p.get("name") or "") not in {"page", "limit"}]
        if qparams:
            q_inner: list[str] = []
            for p in qparams:
                api_key = p.get("name") or ""
                n8n_name = to_camel(api_key)
                field_type, extra = map_body_field_type(
                    {"type": p.get("type"), "enumValues": None}
                )
                chunk = emit_field(
                    n8n_name=n8n_name,
                    display=to_title(api_key),
                    field_type=field_type,
                    extra=extra,
                    required=False,
                    show=show,
                )
                chunk_inner = re.sub(
                    r",\n\t\tdisplayOptions: \{[\s\S]*?\n\t\t\},", "", chunk,
                )
                q_inner.append(chunk_inner)
                cat["queryMap"][n8n_name] = api_key
            field_chunks.append(
                emit_collection(
                    name="filters",
                    display="Filters",
                    children_src=q_inner,
                    show=show,
                )
            )

        # Pagination for collection GETs (offset-based in v1)
        if coll_get:
            return_all = (
                "\t{\n"
                "\t\tdisplayName: 'Return All',\n"
                "\t\tname: 'returnAll',\n"
                "\t\ttype: 'boolean',\n"
                "\t\tdefault: false,\n"
                "\t\tdescription: 'Whether to return all results or only up to a given limit',\n"
                "\t\tdisplayOptions: {\n"
                "\t\t\tshow: {\n"
                "\t\t\t\tapiVersion: ['v1'],\n"
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
                "\t\t\t\tapiVersion: ['v1'],\n"
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


def main() -> None:
    data = json.loads(SPEC.read_text())
    areas = data["areas"]

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    resource_options: list[tuple[str, str, str]] = []  # (key, value, title)
    catalogs: dict[str, dict] = {}
    all_field_chunks: list[str] = []

    for area_slug, area in areas.items():
        # area base_url e.g. https://api.holded.com/api/invoicing/v1
        # path prefix for our holdedApiRequest is everything after /api
        base_path = area["base_url"].split("/api", 1)[1]  # → /invoicing/v1
        # Group endpoints by group slug
        by_group: dict[str, list[dict]] = {}
        for ep in area["endpoints"]:
            by_group.setdefault(ep["group"], []).append(ep)
        for group_slug, eps in by_group.items():
            if (area_slug, group_slug) in EXCLUDE_RESOURCES:
                continue
            if (area_slug, group_slug) not in RESOURCE_MAP:
                print(
                    f"WARNING: no display map for ({area_slug}, {group_slug}); skipping",
                    file=sys.stderr,
                )
                continue
            value, title = RESOURCE_MAP[(area_slug, group_slug)]
            chunks, cat = emit_resource(area_slug, group_slug, value, title, base_path, eps)
            catalogs[value] = cat
            all_field_chunks.extend(chunks)
            resource_options.append((group_slug, value, title))

    resource_options.sort(key=lambda t: t[2])

    def desc_for(value: str) -> str:
        if value in V2_VALUES:
            return "Available in both V1 and V2 — schemas differ between versions"
        hint = V1_ONLY_HINT.get(value)
        return "V1 (legacy) only" + (f". {hint}" if hint else "")

    sel_options = ",\n".join(
        f"\t{{ name: {js_string(title + ' (V1)')}, value: {js_string(value)}, description: {js_string(desc_for(value))} }}"
        for _slug, value, title in resource_options
    )

    cat_literal = "{\n" + ",\n".join(
        f"\t{js_string(res_val)}: " + json.dumps(c, indent=2, ensure_ascii=False).replace("\n", "\n\t")
        for res_val, c in catalogs.items()
    ) + "\n}"

    header = (
        "/* eslint-disable */\n"
        "// AUTO-GENERATED by spec/gen-v1.py from spec/v1-endpoints.json.\n"
        "// Do not edit by hand — regenerate with `python3 spec/gen-v1.py`.\n\n"
        "import type { INodeProperties } from 'n8n-workflow';\n\n"
    )

    res_opts_block = (
        "export const V1_RESOURCE_OPTIONS: Array<{ name: string; value: string; description?: string }> = [\n"
        + sel_options
        + ",\n];\n\n"
    )

    catalog_block = (
        "export interface V1EndpointMeta {\n"
        "\tmethod: string;\n"
        "\tpath: string;\n"
        "\tpathParams: Array<{ name: string; key: string }>;\n"
        "\tqueryMap: Record<string, string>;\n"
        "\tbodyMap: Record<string, string>;\n"
        "\tbodyJsonKeys: string[];\n"
        "\tbodyCsvKeys: string[];\n"
        "\tcollectionGet: boolean;\n"
        "}\n\n"
        "export const V1_CATALOG: Record<string, Record<string, V1EndpointMeta>> = "
        + cat_literal
        + ";\n\n"
    )

    properties_block = (
        "export const v1GeneratedProperties: INodeProperties[] = [\n"
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
