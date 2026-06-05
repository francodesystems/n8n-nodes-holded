"""Shared helpers for parsing Holded portal pages built with Next.js + RSC.

Both v1 and v2 docs embed structured endpoint data inside `self.__next_f.push([1, "..."])`
chunks. v1 ships the full catalog (5 areas × ~136 endpoints) on every page; v2 ships
one OpenAPI-style endpoint object per page.
"""
from __future__ import annotations

import json
import re
from typing import Any
from urllib.request import urlopen, Request
from urllib.error import URLError

UA = "francodesystems-scraper/0.2"
CHUNK_RE = re.compile(r'self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)')
REF_RE = re.compile(r'"\$L?([0-9a-fA-F]+)"')


def fetch(url: str, timeout: int = 30) -> str:
    req = Request(url, headers={"User-Agent": UA})
    with urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace")


def concat_rsc(html: str) -> str:
    """Concatenate all __next_f.push string fragments and decode JS escapes.

    The RSC flight payload encodes UTF-8 bytes as JavaScript \\xHH escapes; the
    `unicode_escape` codec produces those bytes as Latin-1 characters, so a
    final latin-1 → utf-8 round-trip is needed to recover the original
    characters (e.g. \\xc3\\xa1 → 'á' rather than 'Ã¡').
    """
    chunks = CHUNK_RE.findall(html)
    out = []
    for c in chunks:
        decoded = c.encode().decode("unicode_escape")
        try:
            decoded = decoded.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
        out.append(decoded)
    return "".join(out)


def find_balanced(text: str, start_idx: int, open_c: str = "{", close_c: str = "}") -> str | None:
    """Return the substring text[start_idx:end] where end closes the brace at start_idx.

    Respects JSON string literals (skips braces inside quoted strings, honoring backslash escapes).
    """
    if start_idx >= len(text) or text[start_idx] != open_c:
        return None
    depth = 0
    i = start_idx
    in_str = False
    esc = False
    while i < len(text):
        c = text[i]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
        else:
            if c == '"':
                in_str = True
            elif c == open_c:
                depth += 1
            elif c == close_c:
                depth -= 1
                if depth == 0:
                    return text[start_idx:i + 1]
        i += 1
    return None


def sanitize_rsc_json(blob: str) -> str:
    """Replace RSC placeholders with JSON null so json.loads succeeds.

    The portal substitutes missing fields with the string "$undefined" and
    references-to-later-chunks with strings like "$29" or "$L14". For our
    purposes we treat both as missing data.
    """
    blob = re.sub(r'"\$undefined"', "null", blob)
    blob = re.sub(r'"\$L?[0-9a-fA-F]+"', "null", blob)
    return blob


def build_chunk_index(raw: str) -> dict[str, str]:
    """Index every RSC flight line keyed by chunk id.

    Each line looks like `<id>:<payload>` where payload is either JSON
    (object/array/string/number/null) or a typed prefix like `T<hex>,<text>`
    that carries a length-delimited string. We only need to recover the
    payload portion so callers can later replace `"$<id>"` references.
    """
    index: dict[str, str] = {}
    # Walk the payload line by line; the flight format uses real \n separators.
    i = 0
    n = len(raw)
    while i < n:
        # Find the start of a line: optional newline + hex id + ':'
        m = re.match(r'([0-9a-fA-F]+):', raw[i:])
        if not m:
            # Skip to next newline
            nl = raw.find("\n", i)
            if nl == -1:
                break
            i = nl + 1
            continue
        cid = m.group(1)
        payload_start = i + m.end()
        if payload_start >= n:
            break
        first = raw[payload_start]
        if first == "T":
            # Format: T<hex-length>,<text>
            comma = raw.find(",", payload_start + 1)
            if comma == -1:
                i = payload_start + 1
                continue
            try:
                length = int(raw[payload_start + 1:comma], 16)
            except ValueError:
                i = payload_start + 1
                continue
            text = raw[comma + 1:comma + 1 + length]
            index[cid] = text
            i = comma + 1 + length
        elif first in "{[":
            blob = find_balanced(raw, payload_start, first, "}" if first == "{" else "]")
            if blob is None:
                # malformed; advance one
                i = payload_start + 1
                continue
            index[cid] = blob
            i = payload_start + len(blob)
        elif first == '"':
            # Walk a JSON string
            j = payload_start + 1
            esc = False
            while j < n:
                c = raw[j]
                if esc:
                    esc = False
                elif c == "\\":
                    esc = True
                elif c == '"':
                    j += 1
                    break
                j += 1
            index[cid] = raw[payload_start:j]
            i = j
        else:
            # Other typed prefixes (I[...], $S..., numbers) — skip to newline.
            nl = raw.find("\n", payload_start)
            if nl == -1:
                break
            i = nl + 1
    return index


def _ref_value(blob: str, chunks: dict[str, str]) -> str | None:
    """Resolve a single text-style chunk into a JSON-quotable string."""
    return chunks.get(blob)


def resolve_refs_in_object(obj, chunks: dict[str, str]):
    """Walk a parsed object and rewrite null fields that originated from a $ref
    where the referenced chunk is a text payload.

    This is a second pass — we keep sanitize_rsc_json's nulling for safe parsing,
    then look at the original blob to recover any `"<key>":"$<id>"` patterns
    whose target is text in `chunks`, and slot the text back into the object.
    """
    return obj  # placeholder — call recover_text_refs at the source instead


def recover_text_refs(blob: str, chunks: dict[str, str]) -> str:
    """Rewrite `"$<id>"` references inside a JSON blob to inline string values,
    so subsequent json.loads sees the actual text.

    Only replaces refs whose target chunk is a string payload. References to
    structural chunks (arrays / objects) are still nulled by sanitize_rsc_json.
    """
    def repl(m: re.Match) -> str:
        cid = m.group(1)
        val = chunks.get(cid)
        if val is None:
            return "null"
        # If the chunk itself looks like a quoted string, keep as-is.
        if val.startswith('"') and val.endswith('"'):
            return val
        # If it looks like a JSON object/array, we can't inline as a string —
        # but for response bodies it's often a stringified JSON literal, which
        # we want as a JSON string in the output. Wrap accordingly.
        return json.dumps(val)
    return REF_RE.sub(repl, blob)


def parse_object_at(text: str, idx: int) -> dict[str, Any] | None:
    """Extract the JSON object whose opening '{' is at text[idx], parse it."""
    blob = find_balanced(text, idx)
    if blob is None:
        return None
    try:
        return json.loads(sanitize_rsc_json(blob))
    except json.JSONDecodeError:
        return None


def find_enclosing_object_start(text: str, inner_idx: int) -> int | None:
    """Walk backwards from inner_idx and return the index of the enclosing '{'."""
    depth = 0
    i = inner_idx
    while i >= 0:
        c = text[i]
        if c == "}":
            depth += 1
        elif c == "{":
            if depth == 0:
                return i
            depth -= 1
        i -= 1
    return None
