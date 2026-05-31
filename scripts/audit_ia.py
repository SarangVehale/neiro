#!/usr/bin/env python3
"""
NEIRO 音色 — audit Internet Archive items vs local catalogue.

Read-only reconciliation. For each album in `music/`, GET
`https://archive.org/metadata/<identifier>` and compare the number of
audio + cover files on IA against the count in the working tree. Does
not upload anything — drift surfaces as a non-zero exit so the
monthly cron alerts on missing/incomplete albums.

Usage:
    python scripts/audit_ia.py            # full audit, JSON summary on stderr
    python scripts/audit_ia.py --quiet    # only print drift

Exit codes:
    0  every album fully present on IA
    1  drift detected (some albums missing or with fewer files than local)
    2  network/transient errors prevented a complete audit
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

from sync_archive_org import (
    AUDIO_EXT,
    COVER_NAMES,
    MUSIC,
    ROOT,
    album_identifier,
    find_album_dirs,
)

META_URL = "https://archive.org/metadata/{ident}"


def expected_file_count(album_dir: Path) -> int:
    n = 0
    for f in album_dir.iterdir():
        if not f.is_file():
            continue
        if f.suffix.lower() in AUDIO_EXT or f.name.lower() in COVER_NAMES \
                or f.name.lower().startswith("folder."):
            n += 1
    return n


def fetch_item_meta(ident: str) -> dict | None:
    try:
        with urllib.request.urlopen(META_URL.format(ident=ident), timeout=20) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        print(f"WARN: {ident}: fetch failed ({e}); will retry next audit",
              file=sys.stderr)
        raise


def ia_file_count(meta: dict) -> int:
    """Count IA item files that came from us (originals, not derivatives)."""
    if not meta or "files" not in meta:
        return 0
    return sum(
        1 for f in meta["files"]
        if f.get("source") == "original"
        and (
            Path(f.get("name", "")).suffix.lower() in AUDIO_EXT
            or f.get("name", "").lower() in COVER_NAMES
            or f.get("name", "").lower().startswith("folder.")
        )
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="Audit IA items vs local catalogue")
    ap.add_argument("--quiet", action="store_true",
                    help="Only print drift; suppress per-album OK lines")
    args = ap.parse_args()

    drift: list[dict] = []
    transient_errors = 0
    audited = 0

    def audit_one(artist_dir: Path, album_dir: Path, album_name: str) -> None:
        nonlocal transient_errors, audited
        ident = album_identifier(artist_dir.name, album_name)
        expected = expected_file_count(album_dir)
        if expected == 0:
            return
        try:
            meta = fetch_item_meta(ident)
        except Exception:
            transient_errors += 1
            return
        audited += 1
        if meta is None:
            drift.append({
                "identifier": ident,
                "album": f"{artist_dir.name} / {album_name}",
                "kind": "missing",
                "expected": expected,
                "actual": 0,
            })
            if not args.quiet:
                print(f"  ✗ {ident}: missing (expected {expected} file(s))")
            return
        actual = ia_file_count(meta)
        if actual < expected:
            drift.append({
                "identifier": ident,
                "album": f"{artist_dir.name} / {album_name}",
                "kind": "incomplete",
                "expected": expected,
                "actual": actual,
            })
            if not args.quiet:
                print(f"  ✗ {ident}: incomplete ({actual}/{expected})")
        elif not args.quiet:
            print(f"  ✓ {ident}: {actual} file(s)")

    for artist_dir in sorted(p for p in MUSIC.iterdir()
                             if p.is_dir() and not p.name.startswith("_")):
        if not args.quiet:
            print(f"\n{artist_dir.name}")
        # Loose tracks → "Singles" pseudo-album
        loose = [
            p for p in artist_dir.iterdir()
            if p.is_file() and p.suffix.lower() in AUDIO_EXT
        ]
        if loose:
            audit_one(artist_dir, artist_dir, "Singles")
        for album_dir in find_album_dirs(artist_dir):
            album_name = " / ".join(album_dir.relative_to(artist_dir).parts)
            audit_one(artist_dir, album_dir, album_name)

    print(
        f"\nAudit: {audited} album(s) checked, {len(drift)} drift, "
        f"{transient_errors} transient error(s).",
        file=sys.stderr,
    )

    if drift:
        print(json.dumps({"drift": drift}, indent=2))
        return 1
    if transient_errors:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
