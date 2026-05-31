#!/usr/bin/env python3
"""
NEIRO 音色 — extract track metadata into tracks.yaml files.

Run this ONCE before migrating audio to external storage.
It reads each audio file with mutagen and writes a tracks.yaml beside it so
that build_catalogue.py can reconstruct the catalogue without the audio files
being present on disk (metadata-only / no-LFS mode).

Usage:
    pip install mutagen PyYAML
    python scripts/extract_metadata.py [--dry-run]

After running:
    1. Commit all generated tracks.yaml files.
    2. Run scripts/sync_r2.py to upload audio to Cloudflare R2.
    3. Remove audio from git: see instructions printed at the end.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

try:
    import mutagen  # type: ignore
except ImportError:
    print("ERROR: pip install mutagen", file=sys.stderr)
    sys.exit(1)

try:
    import yaml  # type: ignore
except ImportError:
    print("ERROR: pip install PyYAML", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
MUSIC = ROOT / "music"
AUDIO_EXT = {".flac", ".mp3", ".m4a", ".aac"}
_COVER_NAMES = ("cover.jpg", "cover.jpeg", "cover.png", "folder.jpg", "folder.jpeg", "folder.png")


def _has_cover_in_tree(album_dir: Path) -> bool:
    """True if album_dir or any ancestor has a cover image — mirrors
    build_catalogue.find_cover_file's discovery scope."""
    d = album_dir
    while True:
        for n in _COVER_NAMES:
            if (d / n).exists():
                return True
        # stop at music/ root
        if d == MUSIC or not d.is_relative_to(MUSIC):
            return False
        d = d.parent


def _extract_embedded_cover(audio_path: Path) -> bytes | None:
    """Copy of build_catalogue.extract_embedded_cover — kept here to keep
    this script standalone."""
    try:
        mf = mutagen.File(audio_path)
    except Exception:
        return None
    if mf is None:
        return None
    covr = getattr(mf, "tags", None) and mf.tags.get("covr") if mf.tags else None
    if covr:
        try:
            return bytes(covr[0])
        except Exception:
            pass
    if mf.tags:
        for key in mf.tags.keys():
            if key.startswith("APIC"):
                try:
                    return mf.tags[key].data
                except Exception:
                    pass
    pics = getattr(mf, "pictures", None)
    if pics:
        try:
            return pics[0].data
        except Exception:
            pass
    return None


def extract_cover_to_disk(audio_files: list[Path], album_dir: Path, dry_run: bool) -> bool:
    """If album_dir (and ancestors) have no cover image but the first audio
    file has embedded art, write it to album_dir/cover.jpg. Returns True
    when a cover was extracted. No-op when a cover already exists.

    Why: once audio moves to R2, build_catalogue can no longer fall back
    to embedded art. Pre-extracting cover.jpg now ensures Singles/comp dirs
    keep their cover after migration.
    """
    if not audio_files or _has_cover_in_tree(album_dir):
        return False
    raw = _extract_embedded_cover(audio_files[0])
    if not raw or len(raw) < 128:
        return False
    out = album_dir / "cover.jpg"
    if dry_run:
        print(f"  [dry-run] would extract embedded cover to {out.relative_to(ROOT)}")
        return True
    out.write_bytes(raw)
    print(f"  extracted cover → {out.relative_to(ROOT)} ({len(raw) // 1024} KB)")
    return True


def slug_title(path: Path) -> tuple[int, str]:
    m = re.match(r"\s*(\d+)\s*[-–.]\s*(.+)", path.stem)
    if m:
        return int(m.group(1)), m.group(2).strip()
    return 0, path.stem


def read_track(f: Path, idx: int) -> dict:
    number, title = slug_title(f)
    duration = 0
    try:
        mf = mutagen.File(f, easy=True)
        if mf is not None:
            if mf.tags:
                if mf.tags.get("title"):
                    title = mf.tags["title"][0]
                tn = mf.tags.get("tracknumber")
                if tn:
                    number = int(str(tn[0]).split("/")[0])
            if getattr(mf, "info", None) and getattr(mf.info, "length", None):
                duration = int(mf.info.length)
    except Exception:
        pass
    return {
        "number": number or (idx + 1),
        "title": title,
        "duration_sec": duration,
        "format": f.suffix.lstrip(".").upper(),
        "size_mb": round(f.stat().st_size / (1024 * 1024), 2),
        "path": str(f.relative_to(ROOT)),
    }


def find_album_dirs(artist_dir: Path) -> list[Path]:
    """Mirror build_catalogue.find_album_dirs: every directory at any depth
    under artist_dir that directly contains audio files. Required so the
    extracted tracks.yaml set matches what the catalogue builder walks
    (handles structures like music/Lofi/Tokyo chill lab/<album>/track.mp3).
    """
    result = []
    for d in sorted(artist_dir.rglob("*")):
        if d.is_dir() and any(
            f.is_file() and f.suffix.lower() in AUDIO_EXT for f in d.iterdir()
        ):
            result.append(d)
    return result


def process_album(audio_files: list[Path], out_path: Path, dry_run: bool) -> int:
    tracks = sorted(
        [read_track(f, i) for i, f in enumerate(audio_files)],
        key=lambda t: t["number"],
    )
    content = yaml.dump(tracks, allow_unicode=True, sort_keys=False, default_flow_style=False)
    rel = out_path.relative_to(ROOT)
    if dry_run:
        print(f"  [dry-run] would write {rel} ({len(tracks)} tracks)")
    else:
        out_path.write_text(content, encoding="utf-8")
        print(f"  wrote {rel} ({len(tracks)} tracks)")
    return len(tracks)


def main() -> int:
    ap = argparse.ArgumentParser(description="Extract track metadata into tracks.yaml files")
    ap.add_argument("--dry-run", action="store_true", help="Print what would be written without writing")
    args = ap.parse_args()

    total_albums = 0
    total_tracks = 0
    total_covers = 0

    for artist_dir in sorted(p for p in MUSIC.iterdir() if p.is_dir() and not p.name.startswith("_")):
        print(f"\n{artist_dir.name}")

        # Loose tracks in artist root → tracks.yaml at artist level
        loose = sorted(p for p in artist_dir.iterdir() if p.is_file() and p.suffix.lower() in AUDIO_EXT)
        if loose:
            n = process_album(loose, artist_dir / "tracks.yaml", args.dry_run)
            total_albums += 1
            total_tracks += n
            if extract_cover_to_disk(loose, artist_dir, args.dry_run):
                total_covers += 1

        # Album directories at any depth (matches build_catalogue.py)
        for album_dir in find_album_dirs(artist_dir):
            audio = sorted(p for p in album_dir.iterdir() if p.is_file() and p.suffix.lower() in AUDIO_EXT)
            if not audio:
                continue
            n = process_album(audio, album_dir / "tracks.yaml", args.dry_run)
            total_albums += 1
            total_tracks += n
            if extract_cover_to_disk(audio, album_dir, args.dry_run):
                total_covers += 1

    cov_note = f", {total_covers} embedded cover(s) extracted" if total_covers else ""
    print(f"\nDone: {total_albums} albums, {total_tracks} tracks{cov_note}")
    if not args.dry_run:
        print("\nNext steps:")
        print("  1. Review and commit the tracks.yaml files:")
        print('       git add music/**/*.yaml && git commit -m "feat: add track metadata for LFS-free CI"')
        print("  2. Upload audio to R2:")
        print("       python scripts/sync_r2.py --account-id ACCT --bucket BUCKET --access-key KEY --secret-key SECRET")
        print("  3. Remove audio from git tracking:")
        print("       git rm --cached $(git ls-files '*.mp3' '*.m4a' '*.flac' '*.aac')")
        print("       # Update .gitattributes to remove audio LFS rules, then commit")
        print("  4. Clean LFS history (frees quota — requires force push):")
        print("       pip install git-filter-repo")
        print("       git filter-repo --path-glob '*.mp3' --path-glob '*.m4a' --path-glob '*.flac' --path-glob '*.aac' --invert-paths")
        print("       git push --force-with-lease")
        print("  5. Ask GitHub support to GC orphaned LFS objects after the force push.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
