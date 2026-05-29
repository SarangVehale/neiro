#!/usr/bin/env python3
"""
Inject media_base_url into the committed catalogue for deployment.

Usage:
    python scripts/inject_cdn.py <cdn_base_url>

Reads  _catalogue/catalogue.json
Writes public/_catalogue/catalogue.json  (creates dirs as needed)
"""
import json
import pathlib
import sys

if len(sys.argv) < 2:
    print("usage: inject_cdn.py <media_base_url>", file=sys.stderr)
    sys.exit(1)

src = pathlib.Path("_catalogue/catalogue.json")
dst = pathlib.Path("public/_catalogue/catalogue.json")
dst.parent.mkdir(parents=True, exist_ok=True)

cat = json.loads(src.read_text(encoding="utf-8"))
cat["meta"]["media_base_url"] = sys.argv[1].rstrip("/")
dst.write_text(json.dumps(cat, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"media_base_url → {sys.argv[1]}")
