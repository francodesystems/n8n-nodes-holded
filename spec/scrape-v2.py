#!/usr/bin/env python3
"""Extract one OpenAPI-style endpoint object per Holded v2 portal page.

Each v2 page (https://www.holded.com/es/desarrolladores/referencia-api/<resource>/<op>)
embeds, inside the React Server Components flight payload, a single object with
shape:

    {"endpoint": {"method": "...", "path": "...", "operationId": "...",
                  "slug": "...", "summary": "...", "description": "...",
                  "permission": "...", "tags": [...], "parameters": [...],
                  "requestBody": {"contentType": "...", "schema": {...}},
                  "responses": [{"statusCode": "...", "schema": {...}}, ...],
                  "security": [...], "deprecated": false, "isWebhook": false,
                  "eventName": null}}

We fetch every page listed in v2-sidebar.json (`byResource`), parse the
endpoint object out of the RSC payload, and write the catalog to
v2-endpoints.json. Concurrent fetches (8 workers) keep total runtime well
under a minute for ~365 pages.
"""
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.error import URLError

from rsc import (
    build_chunk_index,
    concat_rsc,
    fetch,
    find_balanced,
    recover_text_refs,
    sanitize_rsc_json,
)

ROOT = Path(__file__).parent
SIDEBAR = ROOT / "v2-sidebar.json"
OUT = ROOT / "v2-endpoints.json"
BASE = "https://www.holded.com"
ENDPOINT_RE = re.compile(r'"endpoint":\{"method":')


def parse_page(href: str, html: str) -> dict | None:
    raw = concat_rsc(html)
    chunks = build_chunk_index(raw)
    m = ENDPOINT_RE.search(raw)
    if not m:
        return None
    start = m.start() + len('"endpoint":')
    blob = find_balanced(raw, start)
    if blob is None:
        return None
    try:
        return json.loads(sanitize_rsc_json(recover_text_refs(blob, chunks)))
    except json.JSONDecodeError:
        return None


def fetch_one(resource: str, href: str) -> tuple[str, str, dict | None, str | None]:
    url = BASE + href
    try:
        html = fetch(url, timeout=30)
    except URLError as e:
        return resource, href, None, f"fetch error: {e}"
    except Exception as e:
        return resource, href, None, f"unexpected: {e}"
    try:
        ep = parse_page(href, html)
    except Exception as e:
        return resource, href, None, f"parse error: {e}"
    if ep is None:
        return resource, href, None, "no endpoint object found"
    return resource, href, ep, None


def main() -> None:
    if not SIDEBAR.exists():
        print(f"ERROR: {SIDEBAR} missing.", file=sys.stderr)
        sys.exit(1)
    sidebar = json.loads(SIDEBAR.read_text())
    by_resource = sidebar["byResource"]

    # Skip resource-landing URLs ({.../referencia-api/<resource>} with no trailing op slug)
    todo = []
    for resource, hrefs in by_resource.items():
        for h in hrefs:
            tail = h.rsplit("/", 1)[-1]
            if tail == resource:
                continue
            todo.append((resource, h))
    print(f"Scraping {len(todo)} v2 pages across {len(by_resource)} resources...", file=sys.stderr)

    out: dict[str, list] = {r: [] for r in by_resource}
    errors: list[tuple[str, str, str]] = []
    done = 0
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(fetch_one, r, h): (r, h) for (r, h) in todo}
        for fut in as_completed(futs):
            r, h = futs[fut]
            done += 1
            try:
                resource, href, ep, err = fut.result()
            except Exception as e:
                errors.append((r, h, f"exception: {e}"))
                continue
            if err:
                errors.append((r, h, err))
                continue
            ep["_slug"] = href
            out[resource].append(ep)
            if done % 25 == 0:
                print(f"  {done}/{len(todo)}", file=sys.stderr)

    # Stable order: by operationId then path
    for r in out:
        out[r].sort(key=lambda e: (e.get("operationId") or "", e.get("path") or ""))

    OUT.write_text(json.dumps({"endpoints": out, "errors": errors}, indent=2, ensure_ascii=False))
    total = sum(len(v) for v in out.values())
    print(f"Wrote {OUT} — {total} endpoints, {len(errors)} errors", file=sys.stderr)
    if errors:
        print("First 10 errors:", file=sys.stderr)
        for e in errors[:10]:
            print(" ", e, file=sys.stderr)


if __name__ == "__main__":
    main()
