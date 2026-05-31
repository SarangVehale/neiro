#!/usr/bin/env python3
"""
NEIRO 音色 — sync music/ to archive.org as the cold backup tier.

One Internet Archive *item* per album. Audio + cover.jpg are uploaded to
each item; metadata (artist, album, year, genre) is set from the album's
meta.yaml / catalogue. The script is idempotent: existing IA items are
inspected and only new or size-changed files are uploaded.

Why this exists: IA is the third leg of the backup tripod
(LFS hot / GitLab warm / IA cold; R2 deferred). Audio + covers live on
the IA item forever — if LFS and the GitLab mirror both go down, the
files can be re-pulled from https://archive.org/details/<identifier>.

Usage:
    pip install internetarchive PyYAML
    ia configure                       # one-time: stash IA credentials
    python scripts/sync_archive_org.py [--dry-run] [--only ARTIST] [--collection X]

CI:
    Used by .github/workflows/archive-sync.yml on the 7th of each month
    with IA_ACCESS_KEY / IA_SECRET_KEY secrets.

Item identifier format:
    neiro-<artist-slug>-<album-slug>
e.g.
    neiro-billie-eilish-happier-than-ever
    neiro-pex-singles

Collection default: opensource_audio (public, no curator approval needed).
Override with --collection if you have a curated collection set up.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

try:
    import yaml  # type: ignore
except ImportError:
    print("ERROR: pip install PyYAML", file=sys.stderr)
    sys.exit(1)

try:
    from internetarchive import get_item, upload, get_session  # type: ignore
except ImportError:
    print("ERROR: pip install internetarchive", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
MUSIC = ROOT / "music"
AUDIO_EXT = {".flac", ".mp3", ".m4a", ".aac"}
COVER_NAMES = ("cover.jpg", "cover.jpeg", "cover.png")
IDENT_PREFIX = "neiro"


def slug(s: str) -> str:
    s = re.sub(r"[^\w\s-]", "", s.lower()).strip()
    s = re.sub(r"[\s_]+", "-", s)
    return re.sub(r"-+", "-", s).strip("-")


def load_yaml(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except Exception:
        return {}


def find_album_dirs(artist_dir: Path) -> list[Path]:
    """Same recursive walk as build_catalogue.py / extract_metadata.py."""
    result = []
    for d in sorted(artist_dir.rglob("*")):
        if not d.is_dir():
            continue
        has_audio = any(
            f.is_file() and f.suffix.lower() in AUDIO_EXT for f in d.iterdir()
        )
        if has_audio:
            result.append(d)
    return result


def collect_album_files(album_dir: Path) -> list[Path]:
    """Audio + cover/folder image for this album dir (one level only)."""
    files = []
    for f in sorted(album_dir.iterdir()):
        if not f.is_file():
            continue
        if f.suffix.lower() in AUDIO_EXT:
            files.append(f)
        elif f.name.lower() in COVER_NAMES:
            files.append(f)
    return files


def is_lfs_pointer(path: Path) -> bool:
    # LFS pointer stubs are <200 bytes and start with this signature.
    # Uploading one to IA would silently replace real audio with a stub.
    try:
        if path.stat().st_size > 200:
            return False
        with open(path, "rb") as fh:
            return fh.read(48).startswith(b"version https://git-lfs")
    except OSError:
        return False


def album_identifier(artist: str, album: str) -> str:
    """Stable IA identifier. IA constraints: lowercase, alphanumeric +
    hyphens + dots/underscores, 5–80 chars, unique forever."""
    ident = f"{IDENT_PREFIX}-{slug(artist)}-{slug(album)}"
    # IA hard cap is 100; we trim to 80 to leave headroom.
    return ident[:80].rstrip("-")


def album_metadata(artist_dir: Path, album_dir: Path, album_name: str) -> dict:
    """IA item metadata derived from meta.yaml + artist.yaml."""
    ameta = load_yaml(artist_dir / "artist.yaml")
    meta = load_yaml(album_dir / "meta.yaml") if album_dir != artist_dir else {}
    return {
        "mediatype": "audio",
        "collection": "opensource_audio",
        "title": f"{artist_dir.name} — {album_name}",
        "creator": artist_dir.name,
        "album": album_name,
        "date": str(meta.get("year") or ameta.get("year") or ""),
        "subject": meta.get("genre") or ameta.get("genre") or "music",
        "description": (
            f"Backup of {artist_dir.name} — {album_name} from the NEIRO 音色 "
            f"archive (https://github.com/SarangVehale/neiro). Audio originals "
            f"preserved here as a passive failsafe."
        ),
        "language": ameta.get("language", "eng"),
        "licenseurl": meta.get("licenseurl", ""),
    }


def remote_file_sizes(item) -> dict[str, int]:
    """Return {filename: size_bytes} for files already on the IA item."""
    if not item.exists:
        return {}
    out = {}
    for f in item.files:
        if f.get("source") == "original":
            try:
                out[f["name"]] = int(f.get("size", 0))
            except (TypeError, ValueError):
                out[f["name"]] = 0
    return out


def sync_album(
    artist_dir: Path,
    album_dir: Path,
    album_name: str,
    dry_run: bool,
    collection: str | None,
) -> tuple[int, int]:
    """Sync one album using files discovered by walking album_dir.

    Thin wrapper around sync_album_files. Returns (uploaded, skipped) —
    failed-file list is dropped here because the full-walk caller (main)
    doesn't surface it. Delta callers should use sync_album_files
    directly.
    """
    files = collect_album_files(album_dir)
    if not files:
        return 0, 0
    u, s, _ = sync_album_files(
        artist_dir, album_dir, album_name, files, dry_run, collection
    )
    return u, s


def sync_album_files(
    artist_dir: Path,
    album_dir: Path,
    album_name: str,
    files: list[Path],
    dry_run: bool,
    collection: str | None,
) -> tuple[int, int, list[Path]]:
    """Sync the given explicit file list to the IA item for this album.

    Returns (uploaded, skipped, failed). On any per-file failure, emits a
    machine-readable `FAILED\\t<repo-relative-path>` line to stderr so
    the pre-push hook and sync_ia_delta.py can build the backup manifest.
    """
    ident = album_identifier(artist_dir.name, album_name)

    pointers = [f for f in files if is_lfs_pointer(f)]
    if pointers:
        if dry_run:
            print(f"  [dry-run] {ident}: skipped — {len(pointers)} LFS "
                  "pointer(s); run `git lfs pull` to preview deltas accurately")
            return 0, 0, []
        print(f"ERROR: {ident}: refusing to upload — these are LFS pointer "
              "stubs, not real audio:", file=sys.stderr)
        for p in pointers:
            print(f"  {p.relative_to(ROOT)}", file=sys.stderr)
        print("Run `git lfs pull` first, then retry.", file=sys.stderr)
        sys.exit(2)

    item = get_item(ident)
    remote = remote_file_sizes(item)
    metadata = album_metadata(artist_dir, album_dir, album_name)
    if collection:
        metadata["collection"] = collection

    skipped = 0
    to_upload: list[Path] = []
    for f in files:
        if f.name in remote and remote[f.name] == f.stat().st_size:
            skipped += 1
            continue
        to_upload.append(f)

    if not to_upload and item.exists:
        print(f"  {ident}: {skipped} file(s) already up to date")
        return 0, skipped, []

    label = "[dry-run] " if dry_run else ""
    print(f"  {label}{ident}: upload {len(to_upload)} file(s) "
          f"({skipped} unchanged)")
    for f in to_upload:
        size_mb = round(f.stat().st_size / (1024 * 1024), 1)
        print(f"    ↑ {f.relative_to(ROOT)} ({size_mb} MB)")

    if dry_run:
        return len(to_upload), skipped, []

    responses = upload(
        ident,
        files=[str(p) for p in to_upload],
        metadata=metadata,
        verbose=False,
        retries=3,
    )
    uploaded = 0
    failed: list[Path] = []
    for f, r in zip(to_upload, responses):
        if r.status_code != 200:
            print(f"    FAILED ({r.status_code}): {r.text[:200]}")
            failed.append(f)
            print(f"FAILED\t{f.relative_to(ROOT)}", file=sys.stderr)
        else:
            uploaded += 1
    # If responses ran short of to_upload (early termination), the
    # remaining files were never attempted — mark them failed too.
    attempted = uploaded + len(failed)
    for f in to_upload[attempted:]:
        failed.append(f)
        print(f"FAILED\t{f.relative_to(ROOT)}", file=sys.stderr)

    return uploaded, skipped, failed


def main() -> int:
    ap = argparse.ArgumentParser(description="Sync music/ to archive.org items")
    ap.add_argument("--dry-run", action="store_true",
                    help="Show what would upload without uploading")
    ap.add_argument("--collection", default=None,
                    help="IA collection (default: opensource_audio)")
    ap.add_argument("--only", default=None, metavar="ARTIST",
                    help="Sync only this artist directory (matches by name)")
    args = ap.parse_args()

    # Sanity: must have IA creds set
    if not args.dry_run:
        access = os.environ.get("IA_ACCESS_KEY")
        secret = os.environ.get("IA_SECRET_KEY")
        # internetarchive uses ~/.config/internetarchive/ia.ini OR env
        if not (access and secret):
            try:
                get_session().get_auth_config()  # raises if not configured
            except Exception:
                print("ERROR: IA credentials missing. Run `ia configure` or set "
                      "IA_ACCESS_KEY + IA_SECRET_KEY.", file=sys.stderr)
                return 2

    total_uploaded = total_skipped = total_albums = 0

    for artist_dir in sorted(p for p in MUSIC.iterdir()
                             if p.is_dir() and not p.name.startswith("_")):
        if args.only and artist_dir.name != args.only:
            continue
        print(f"\n{artist_dir.name}")

        # Loose tracks → "Singles" album
        loose = sorted(p for p in artist_dir.iterdir()
                       if p.is_file() and p.suffix.lower() in AUDIO_EXT)
        if loose:
            u, s = sync_album(artist_dir, artist_dir, "Singles",
                              args.dry_run, args.collection)
            total_uploaded += u
            total_skipped += s
            total_albums += 1

        for album_dir in find_album_dirs(artist_dir):
            album_name = " / ".join(album_dir.relative_to(artist_dir).parts)
            u, s = sync_album(artist_dir, album_dir, album_name,
                              args.dry_run, args.collection)
            total_uploaded += u
            total_skipped += s
            total_albums += 1

    verb = "would upload" if args.dry_run else "uploaded"
    print(f"\nDone: {total_albums} albums, {total_uploaded} file(s) "
          f"{verb}, {total_skipped} unchanged")
    return 0


if __name__ == "__main__":
    sys.exit(main())
