#!/usr/bin/env python3
"""Extract the full Holded v1 endpoint catalog from a single portal page.

Each v1 page embeds the entire reference (5 areas: invoicing, crm, accounting,
projects, team — ~136 endpoints in total) inside the React Server Components
flight payload. We fetch one page, decode the chunks, then locate each area
object by its baseUrl and parse it as JSON.

Each endpoint carries: slug, title, method, path, summary, description,
parameters[], requestBodyExample, requestBodySchema[], responseExamples[].
Final URL is built as `<area.baseUrl><endpoint.path>`.
"""
import json
import re
import sys
from pathlib import Path

from rsc import (
    build_chunk_index,
    concat_rsc,
    fetch,
    find_balanced,
    find_enclosing_object_start,
    recover_text_refs,
    sanitize_rsc_json,
)

ROOT = Path(__file__).parent
OUT = ROOT / "v1-endpoints.json"
SEED_URL = "https://www.holded.com/es/desarrolladores/v1/accounting-api/chart-of-accounts/createaccount"
BASE_URL_RE = re.compile(r'"baseUrl":"(https://api\.holded\.com/api/[^"/]+/v1)"')


def main() -> None:
    print(f"Fetching {SEED_URL} ...", file=sys.stderr)
    html = fetch(SEED_URL)
    raw = concat_rsc(html)
    print(f"  RSC payload: {len(raw)} bytes", file=sys.stderr)
    chunks = build_chunk_index(raw)
    print(f"  chunks indexed: {len(chunks)}", file=sys.stderr)

    areas: dict[str, dict] = {}
    for m in BASE_URL_RE.finditer(raw):
        base = m.group(1)
        start = find_enclosing_object_start(raw, m.start())
        if start is None:
            print(f"  {base}: could not locate enclosing object", file=sys.stderr)
            continue
        blob = find_balanced(raw, start)
        if blob is None:
            print(f"  {base}: brace-matching failed", file=sys.stderr)
            continue
        try:
            obj = json.loads(sanitize_rsc_json(recover_text_refs(blob, chunks)))
        except json.JSONDecodeError as e:
            print(f"  {base}: JSON error {e}", file=sys.stderr)
            continue
        area_slug = obj.get("slug") or base.rsplit("/", 2)[-2] + "-api"
        if area_slug in areas:
            continue
        endpoints = []
        for group in obj.get("groups", []):
            group_slug = group.get("slug")
            group_title = group.get("title")
            for ep in group.get("endpoints", []):
                method = (ep.get("method") or "").upper() or None
                path = ep.get("path")
                url = (base + path) if method and path else None
                endpoints.append({
                    "group": group_slug,
                    "group_title": group_title,
                    "slug": ep.get("slug"),
                    "title": ep.get("title"),
                    "method": method,
                    "url": url,
                    "path": path,
                    "summary": ep.get("summary"),
                    "description": ep.get("description"),
                    "parameters": ep.get("parameters") or [],
                    "request_body_example": ep.get("requestBodyExample"),
                    "request_body_schema": ep.get("requestBodySchema") or [],
                    "response_examples": ep.get("responseExamples") or [],
                })
        areas[area_slug] = {
            "slug": area_slug,
            "title": obj.get("title"),
            "description": obj.get("description"),
            "base_url": base,
            "endpoints": endpoints,
        }

    total = sum(len(a["endpoints"]) for a in areas.values())
    OUT.write_text(json.dumps({"areas": areas}, indent=2, ensure_ascii=False))
    print(f"Wrote {OUT} — {len(areas)} areas, {total} endpoints", file=sys.stderr)
    for slug, area in areas.items():
        print(f"  {slug}: {len(area['endpoints'])} endpoints", file=sys.stderr)


if __name__ == "__main__":
    main()
