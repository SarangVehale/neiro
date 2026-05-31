#!/usr/bin/env python3
"""
NEIRO 音色 — push a specific set of audio/cover files to Internet Archive.

Delta-driven counterpart to sync_archive_org.py. Where the full-walk
script scans every album, this one takes a list of changed files
(typically from `git diff --name-only` in a pre-push hook or CI
workflow) and uploads only those to the corresponding IA items.

Why it exists: pulling every LFS object on every backup burns
bandwidth proportional to the whole library. Delta upload burns
bandwidth proportional to the change. See docs/SETUP_INTERNET_ARCHIVE.md
§5 (pre-push hook) and .github/workflows/ia-on-push.yml.

Usage:
    python scripts/sync_ia_delta.py --files music/Pex/track.mp3 ...
    python scripts/sync_ia_delta.py --files-from /tmp/audio-files.txt

Exit codes:
    0  All files uploaded (or skipped as already-up-to-date)
    1  At least one file failed — FAILED\\t<path> lines on stderr
    2  LFS pointer stub detected — git lfs pull needed before retry
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from sync_archive_org import (
    AUDIO_EXT,
    COVER_NAMES,
    MUSIC,
    ROOT,
    find_album_dirs,
    get_session,
    sync_album_files,
)


def is_audio_or_cover(path: Path) -> bool:
    if path.suffix.lower() in AUDIO_EXT:
        return True
    return path.name.lower() in COVER_NAMES or path.name.lower().startswith("folder.")


def resolve_album(path: Path) -> tuple[Path, Path, str] | None:
    """Map a repo-relative file path to (artist_dir, album_dir, album_name).

    Returns None if the path is outside music/ or doesn't fit the layout.
    """
    try:
        rel = path.resolve().relative_to(MUSIC)
    except ValueError:
        return None
    parts = rel.parts
    if len(parts) < 2:
        return None  # bare file directly under music/ — not an album track
    artist_dir = MUSIC / parts[0]
    if not artist_dir.is_dir():
        return None
    parent = path.parent.resolve()
    if parent == artist_dir:
        # Loose track / cover → "Singles" pseudo-album
        return artist_dir, artist_dir, "Singles"
    album_dir = parent
    album_name = " / ".join(album_dir.relative_to(artist_dir).parts)
    return artist_dir, album_dir, album_name


def main() -> int:
    ap = argparse.ArgumentParser(description="Push specific files to IA items")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--files", nargs="+", default=None,
                   help="Paths to upload (repo-relative or absolute)")
    g.add_argument("--files-from", default=None, metavar="PATH",
                   help="Read newline-separated paths from this file ('-' = stdin)")
    ap.add_argument("--collection", default=None,
                    help="IA collection (default: opensource_audio)")
    ap.add_argument("--dry-run", action="store_true",
                    help="Show what would upload without uploading")
    args = ap.parse_args()

    # Resolve input list
    raw: list[str]
    if args.files:
        raw = args.files
    else:
        src = sys.stdin if args.files_from == "-" else open(args.files_from)
        raw = [line.strip() for line in src if line.strip()]
        if args.files_from != "-":
            src.close()

    paths = [Path(p) if Path(p).is_absolute() else ROOT / p for p in raw]
    # Filter out non-audio/cover paths and missing files (the caller may
    # have included tracks.yaml etc. in its diff — just skip them quietly)
    candidates = [p for p in paths if p.exists() and is_audio_or_cover(p)]
    missing = [p for p in paths if not p.exists()]
    if missing:
        for p in missing:
            print(f"WARN: skipping missing path: {p}", file=sys.stderr)
    if not candidates:
        print("No audio/cover files in input — nothing to upload.")
        return 0

    # Auth check (same shape as sync_archive_org.py main)
    if not args.dry_run:
        access = os.environ.get("IA_ACCESS_KEY")
        secret = os.environ.get("IA_SECRET_KEY")
        if not (access and secret):
            try:
                get_session().get_auth_config()
            except Exception:
                print("ERROR: IA credentials missing. Run `ia configure` or set "
                      "IA_ACCESS_KEY + IA_SECRET_KEY.", file=sys.stderr)
                return 2

    # Group files by album. Key by album_dir so nested-album files coalesce.
    grouped: dict[Path, tuple[Path, str, list[Path]]] = {}
    unresolved: list[Path] = []
    for p in candidates:
        meta = resolve_album(p)
        if meta is None:
            unresolved.append(p)
            continue
        artist_dir, album_dir, album_name = meta
        if album_dir not in grouped:
            grouped[album_dir] = (artist_dir, album_name, [])
        grouped[album_dir][2].append(p)
    if unresolved:
        for p in unresolved:
            print(f"WARN: skipping path with unrecognised layout: {p}",
                  file=sys.stderr)

    total_uploaded = total_skipped = 0
    failed_files: list[Path] = []
    for album_dir in sorted(grouped):
        artist_dir, album_name, files = grouped[album_dir]
        print(f"\n{artist_dir.name} / {album_name}")
        u, s, fail = sync_album_files(
            artist_dir, album_dir, album_name, sorted(set(files)),
            args.dry_run, args.collection,
        )
        total_uploaded += u
        total_skipped += s
        failed_files.extend(fail)

    verb = "would upload" if args.dry_run else "uploaded"
    print(f"\nDone: {len(grouped)} album(s), {total_uploaded} file(s) "
          f"{verb}, {total_skipped} unchanged, {len(failed_files)} failed")

    return 1 if failed_files else 0


if __name__ == "__main__":
    sys.exit(main())
