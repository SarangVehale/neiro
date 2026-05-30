#!/usr/bin/env python3
"""
HIBIKI 響 — catalogue + ZIP builder (spec §2, §3).

Walks /music/<Artist>/…/<Album>/, reads ID3/MP4 tags (mutagen, optional),
honours meta.yaml / bio.md / artist.yaml / tracks.yaml overrides, extracts
cover art as a tiny base64 thumbnail, writes _catalogue/catalogue.json, and
pre-builds sharded iPod-structure ZIPs into _zips/.

Album discovery is fully recursive: any directory that directly contains
audio files is treated as an album, regardless of nesting depth under the
artist directory. This handles structures like:
    music/Lofi/Tokyo chill lab/First Instar Melody (Side-A)/01 - track.mp3

Runs with zero third-party deps (graceful fallback to filename parsing);
mutagen + Pillow + PyYAML are used when present for richer output.

Metadata-only mode: if tracks.yaml exists beside an album, audio files need
not be present on disk. This lets CI build the catalogue without pulling LFS.

Usage:
    python scripts/build_catalogue.py                     # catalogue only
    python scripts/build_catalogue.py --zips              # + sharded ZIPs
    python scripts/build_catalogue.py --cdn-base https:// # embed CDN URL
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import os
import re
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

# ── optional deps ─────────────────────────────────────────────────────────────
try:
    import mutagen  # type: ignore
except Exception:
    mutagen = None
try:
    import yaml  # type: ignore
except Exception:
    yaml = None
try:
    from PIL import Image  # type: ignore
except Exception:
    Image = None

ROOT = Path(__file__).resolve().parent.parent
MUSIC = ROOT / "music"
OUT = ROOT / "_catalogue" / "catalogue.json"
ZIPS = ROOT / "_zips"

AUDIO_EXT = {".flac", ".mp3", ".m4a", ".aac"}
SHARD_THRESHOLD_MB = float(os.environ.get("SHARD_THRESHOLD_MB", "150"))
SHARD_TARGET_MB = float(os.environ.get("SHARD_TARGET_MB", "130"))


def slug(s: str) -> str:
    s = re.sub(r"[^\w\s-]", "", s.lower()).strip()
    return re.sub(r"[\s_]+", "-", s)


def fmt_of(path: Path) -> str:
    return path.suffix.lstrip(".").upper()


def read_tags(path: Path) -> dict:
    """Return {title, number, duration_sec, genre} using mutagen when available."""
    out: dict = {"title": None, "number": None, "duration_sec": 0, "genre": None}
    if mutagen is not None:
        try:
            mf = mutagen.File(path, easy=True)
            if mf is not None:
                if mf.tags:
                    if mf.tags.get("title"):
                        out["title"] = mf.tags["title"][0]
                    tn = mf.tags.get("tracknumber")
                    if tn:
                        out["number"] = int(str(tn[0]).split("/")[0])
                    if mf.tags.get("genre"):
                        out["genre"] = mf.tags["genre"][0].strip()
                if getattr(mf, "info", None) and getattr(mf.info, "length", None):
                    out["duration_sec"] = int(mf.info.length)
        except Exception:
            pass
    if out["title"] is None or out["number"] is None:
        m = re.match(r"\s*(\d+)\s*[-–.]\s*(.+)", path.stem)
        if m:
            out["number"] = out["number"] or int(m.group(1))
            out["title"] = out["title"] or m.group(2).strip()
        else:
            out["title"] = out["title"] or path.stem
    return out


def load_yaml(path: Path) -> dict:
    if path.exists() and yaml is not None:
        try:
            return yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except Exception:
            return {}
    return {}


def load_tracks_yaml(path: Path) -> list[dict] | None:
    """Read pre-computed track list from tracks.yaml; returns None if absent."""
    if not path.exists() or yaml is None:
        return None
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or []
        return [
            {
                "number": int(t.get("number", i + 1)),
                "title": str(t.get("title", "")),
                "duration_sec": int(t.get("duration_sec", 0)),
                "format": str(t.get("format", "")).upper(),
                "size_mb": float(t.get("size_mb", 0.0)),
                "path": str(t.get("path", "")),
                "genre": t.get("genre"),
                "_path": "",
            }
            for i, t in enumerate(data)
        ]
    except Exception:
        return None


def find_album_dirs(artist_dir: Path) -> list[Path]:
    """Return all directories (any depth under artist_dir) that directly contain audio.

    This handles nested structures like:
        artist/sub-artist/album/track.mp3  (depth 4 from music/)
    as well as the standard:
        artist/album/track.mp3             (depth 3 from music/)
    """
    result = []
    for d in sorted(artist_dir.rglob("*")):
        if d.is_dir() and any(
            f.is_file() and f.suffix.lower() in AUDIO_EXT for f in d.iterdir()
        ):
            result.append(d)
    return result


def album_display_name(album_dir: Path, artist_dir: Path) -> str:
    """Human-readable album name, including parent dirs when nested."""
    rel = album_dir.relative_to(artist_dir)
    parts = rel.parts
    # Single-level: "Album Name" — keep as-is
    # Multi-level:  "Sub-artist / Album Name" — show hierarchy
    return " / ".join(parts) if len(parts) > 1 else parts[0]


def dominant_genre(genres: list[str | None]) -> str | None:
    clean = [g for g in genres if g]
    if not clean:
        return None
    return max(set(clean), key=clean.count)


def load_inherited_meta(album_dir: Path, artist_dir: Path) -> dict:
    """Merge artist.yaml from every directory between artist_dir and album_dir.

    Applied from least to most specific so that a sub-artist directory
    (e.g. music/Lofi/Tokyo chill lab/artist.yaml) overrides the top-level
    artist.yaml when building albums nested under it.
    """
    dirs: list[Path] = []
    d = album_dir.parent if album_dir != artist_dir else artist_dir
    while True:
        dirs.append(d)
        if d == artist_dir:
            break
        d = d.parent
        if not d.is_relative_to(artist_dir):
            break
    combined: dict = {}
    for d in reversed(dirs):  # artist_dir first → most-specific last
        combined.update(load_yaml(d / "artist.yaml"))
    return combined


_IMG_EXT = {".jpg", ".jpeg", ".png", ".svg", ".webp"}


def find_cover_file(album_dir: Path, artist_dir: Path) -> Path | None:
    """Return path to cover image or None, searching up to artist_dir.

    Preference order: cover.{jpg,jpeg,png,svg} → folder.{jpg,jpeg,png} →
    a single image sitting alone in the album dir (handles loose
    per-album art that wasn't renamed to cover.jpg).
    """
    search_dirs: list[Path] = []
    d = album_dir
    while True:
        search_dirs.append(d)
        if d == artist_dir:
            break
        d = d.parent
        if not d.is_relative_to(artist_dir):
            break
    named = ("cover.jpg", "cover.jpeg", "cover.png", "cover.svg",
             "folder.jpg", "folder.jpeg", "folder.png")
    for d in search_dirs:
        for name in named:
            p = d / name
            if p.exists():
                return p
    # Fallback: if album_dir contains exactly one image file, treat it as the cover.
    imgs = [p for p in album_dir.iterdir()
            if p.is_file() and p.suffix.lower() in _IMG_EXT]
    if len(imgs) == 1:
        return imgs[0]
    return None


def extract_embedded_cover(audio_path: Path) -> bytes | None:
    """Return raw bytes of embedded artwork from an audio file, or None.

    Used as the last-resort cover source for compilation/Singles dirs that
    have no on-disk cover.jpg. mutagen handles MP4 ('covr'), ID3 (APIC),
    and FLAC (Picture blocks) transparently.
    """
    if mutagen is None or not audio_path.exists():
        return None
    try:
        mf = mutagen.File(audio_path)
    except Exception:
        return None
    if mf is None:
        return None
    # MP4 / M4A / AAC: 'covr' atom is a list of MP4Cover (bytes-like)
    covr = getattr(mf, "tags", None) and mf.tags.get("covr") if mf.tags else None
    if covr:
        try:
            return bytes(covr[0])
        except Exception:
            pass
    # ID3 (MP3): APIC frames
    if mf.tags:
        for key in mf.tags.keys():
            if key.startswith("APIC"):
                try:
                    return mf.tags[key].data
                except Exception:
                    pass
    # FLAC: Picture blocks at the file level
    pics = getattr(mf, "pictures", None)
    if pics:
        try:
            return pics[0].data
        except Exception:
            pass
    return None


def cover_thumb(
    album_dir: Path,
    artist_dir: Path,
    album_id: str,
    size: int = 96,
    quality: int = 65,
    out_dir: Path | None = None,
    fallback_audio: Path | None = None,
) -> str | None:
    """Write a small JPEG thumbnail to ``out_dir/<album_id>.<hash>.jpg``
    and return the relative path (or None when no cover was found).

    Discovery order:
      1. cover.* / folder.* / single loose image in album_dir
      2. embedded artwork in ``fallback_audio`` (first track of the album)

    Externalising the thumbnail keeps catalogue.json small (used to be
    base64-baked; that bloated the JSON past 240 KB on 45 albums). The
    hash in the filename gives each cover its own immutable URL so
    browsers can cache aggressively.
    """
    if out_dir is None:
        out_dir = ROOT / "public" / "_thumbs"
    cover_file = find_cover_file(album_dir, artist_dir)
    raw: bytes | None = None
    src_ext: str | None = None
    if cover_file is not None:
        if cover_file.suffix.lower() == ".svg":
            return None  # SVGs served as-is via cover_path
        raw = cover_file.read_bytes()
        if len(raw) < 128:
            raw = None  # LFS pointer stub or empty — fall through to embedded
        else:
            src_ext = cover_file.suffix.lower()
    if raw is None and fallback_audio is not None:
        raw = extract_embedded_cover(fallback_audio)
        if raw and len(raw) < 128:
            raw = None
    if raw is None:
        return None
    if Image is not None:
        try:
            im = Image.open(io.BytesIO(raw)).convert("RGB")
            im.thumbnail((size, size))
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=quality, optimize=True)
            raw = buf.getvalue()
            ext = "jpg"
        except Exception:
            return None  # PIL can't open it — not a real image
    else:
        ext = "png" if src_ext == ".png" else "jpg"
    h = hashlib.sha256(raw).hexdigest()[:8]
    out_dir.mkdir(parents=True, exist_ok=True)
    name = f"{album_id}.{h}.{ext}"
    (out_dir / name).write_bytes(raw)
    return f"_thumbs/{name}"


def shard_tracks(tracks: list[dict]) -> list[list[dict]]:
    """Group tracks into shards on track boundaries (spec §3)."""
    total = sum(t["size_mb"] for t in tracks)
    if total <= SHARD_THRESHOLD_MB:
        return [tracks]
    shards: list[list[dict]] = []
    cur: list[dict] = []
    cur_mb = 0.0
    for t in tracks:
        if cur and cur_mb + t["size_mb"] > SHARD_TARGET_MB:
            shards.append(cur)
            cur, cur_mb = [], 0.0
        cur.append(t)
        cur_mb += t["size_mb"]
    if cur:
        shards.append(cur)
    return shards


def build_zip(
    artist: str,
    album: str,
    shard_tracks_: list[dict],
    label: str,
    album_dir: Path,
    artist_dir: Path,
) -> float:
    """Pre-build one iPod-structure ZIP into _zips/. Returns size in MB."""
    ZIPS.mkdir(parents=True, exist_ok=True)
    # Sanitise album name for filesystem use
    safe_album = re.sub(r'[<>:"/\\|?*]', "-", album)
    zpath = ZIPS / f"{artist} - {safe_album} [{label}].zip"
    readme = (
        f"{label}. Drag all parts into Music.app — they merge automatically.\n"
        f"{artist} — {album}\n"
    )
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_STORED) as z:
        folder = f"{artist}/{safe_album}"
        for t in shard_tracks_:
            src = Path(t["_path"])
            arc = f"{folder}/{t['number']:02d} - {t['title']}.{t['format'].lower()}"
            if src.exists():
                z.write(src, arc)
        # Cover: search album_dir and parents up to artist_dir
        d = album_dir
        found_cover = False
        while not found_cover:
            for name in ("cover.jpg", "cover.jpeg", "cover.png"):
                cp = d / name
                if cp.exists():
                    z.write(cp, f"{folder}/cover.jpg")
                    found_cover = True
                    break
            if d == artist_dir or found_cover:
                break
            d = d.parent
        z.writestr(f"{folder}/README.txt", readme)
    return round(zpath.stat().st_size / (1024 * 1024), 1)


def process_artist(
    artist_dir: Path,
    args: argparse.Namespace,
) -> tuple[dict | None, int]:
    """Build the artist entry. Returns (artist_dict, track_count) or (None, 0)."""
    bio_path = artist_dir / "bio.md"
    bio = bio_path.read_text(encoding="utf-8").strip() if bio_path.exists() else ""
    ameta = load_yaml(artist_dir / "artist.yaml")
    albums = []
    total_songs = 0

    # ── Loose tracks sitting directly in the artist folder ───────────────────
    loose = sorted(
        p for p in artist_dir.iterdir()
        if p.is_file() and p.suffix.lower() in AUDIO_EXT
    )
    if loose:
        n, entry = process_album(
            album_dir=artist_dir,
            artist_dir=artist_dir,
            audio_files=loose,
            forced_name="Singles",
            ameta=ameta,
            args=args,
        )
        if entry:
            albums.append(entry)
            total_songs += n

    # ── Album directories at any depth ───────────────────────────────────────
    for album_dir in find_album_dirs(artist_dir):
        audio_files = sorted(
            p for p in album_dir.iterdir()
            if p.is_file() and p.suffix.lower() in AUDIO_EXT
        )
        n, entry = process_album(
            album_dir=album_dir,
            artist_dir=artist_dir,
            audio_files=audio_files,
            forced_name=None,
            ameta=ameta,
            args=args,
        )
        if entry:
            albums.append(entry)
            total_songs += n

    if not albums:
        return None, 0

    artist_entry = {
        "id": slug(artist_dir.name),
        "name": artist_dir.name,
        "kana": ameta.get("kana", ""),
        "origin": ameta.get("origin", ""),
        "genre": ameta.get("genre", ""),
        "links": ameta.get("links", []),
        "bio": bio,
        "albums": albums,
    }
    return artist_entry, total_songs


def process_album(
    album_dir: Path,
    artist_dir: Path,
    audio_files: list[Path],
    forced_name: str | None,
    ameta: dict,
    args: argparse.Namespace,
) -> tuple[int, dict | None]:
    """Build one album entry. Returns (track_count, album_dict) or (0, None)."""
    # Metadata-only mode: tracks.yaml replaces audio file scanning
    tracks_yaml_path = album_dir / "tracks.yaml"
    prebuilt = load_tracks_yaml(tracks_yaml_path)

    if prebuilt is None and not audio_files:
        return 0, None

    if forced_name:
        album_name = forced_name
    else:
        album_name = album_display_name(album_dir, artist_dir)

    meta_path = album_dir / "meta.yaml"
    meta = load_yaml(meta_path)

    # Inherited artist meta: merges artist.yaml from every parent dir up to artist_dir
    inherited = load_inherited_meta(album_dir, artist_dir)

    if prebuilt is not None:
        tracks = prebuilt
    else:
        tracks = []
        for f in audio_files:
            tags = read_tags(f)
            size_mb = round(f.stat().st_size / (1024 * 1024), 1)
            tracks.append({
                "number": tags["number"] or (len(tracks) + 1),
                "title": tags["title"],
                "duration_sec": tags["duration_sec"],
                "format": fmt_of(f),
                "size_mb": size_mb,
                "path": str(f.relative_to(ROOT)),
                "genre": tags["genre"],
                "_path": str(f),
            })

    if not tracks:
        return 0, None

    tracks.sort(key=lambda t: (t["number"], t.get("title") or ""))
    # Compilation / Singles dirs: ID3 tracknumber is often "1/1" on every
    # file (each was tagged as a one-track release). That makes the album
    # view render "01" repeated. If duplicates exist, renumber sequentially
    # in the post-sort order.
    nums = [t["number"] for t in tracks]
    if len(tracks) > 1 and len(set(nums)) < len(tracks):
        for i, t in enumerate(tracks, 1):
            t["number"] = i

    # Genre: album meta.yaml > inherited sub-artist yaml > top-level artist yaml > audio tags
    tag_genres = [t.get("genre") for t in tracks]
    genre = (
        meta.get("genre")
        or inherited.get("genre")
        or ameta.get("genre")
        or dominant_genre(tag_genres)
        or "Unknown"
    )

    total_mb = round(sum(t["size_mb"] for t in tracks), 1)
    groups = shard_tracks(tracks)
    shards = []
    for i, grp in enumerate(groups):
        label = (
            "Full album ZIP" if len(groups) == 1 else f"Part {i + 1} of {len(groups)}"
        )
        size_mb = (
            build_zip(
                artist_dir.name, album_name, grp, label, album_dir, artist_dir,
            )
            if args.zips
            else round(sum(t["size_mb"] for t in grp), 1)
        )
        shards.append({
            "label": label,
            "path": f"_zips/{artist_dir.name} - {re.sub(r'[<>:\"/\\|?*]', '-', album_name)} [{label}].zip",
            "size_mb": size_mb,
        })

    # Slug uses full relative path to prevent collisions in nested structures
    rel_parts = album_dir.relative_to(artist_dir).parts if album_dir != artist_dir else ()
    slug_parts = [artist_dir.name] + list(rel_parts) if rel_parts else [artist_dir.name, album_name]
    album_id = slug("-".join(slug_parts))

    pub_tracks = [
        {k: v for k, v in t.items() if not k.startswith("_") and k != "genre"}
        for t in tracks
    ]

    cover_file = find_cover_file(album_dir, artist_dir)
    # Lex-first on-disk file (by filename), not the sorted track order — keeps
    # the extracted cover stable when the track sort changes (e.g. when we
    # renumber duplicate track-numbers in compilation dirs).
    fallback_audio = audio_files[0] if audio_files else None
    entry = {
        "id": album_id,
        "title": meta.get("title", album_name.split(" / ")[-1]),
        "year": meta.get("year"),
        "genre": genre,
        "notes": meta.get("notes", ""),
        "license": meta.get("license", ""),
        # P3: thumbnails written to public/_thumbs/<id>.<hash>.jpg.
        # Catalogue field is the relative path; data adapter wires it up.
        # Compilation/Singles dirs without cover.jpg fall back to embedded art.
        "cover_thumb": cover_thumb(
            album_dir, artist_dir, album_id,
            size=args.thumb_size, quality=args.thumb_quality,
            fallback_audio=fallback_audio,
        ),
        "cover_path": str(cover_file.relative_to(ROOT)) if cover_file else None,
        "total_size_mb": total_mb,
        "shards": shards,
        "tracks": pub_tracks,
    }
    return len(tracks), entry


def main(build_zips: bool | None = None) -> int:
    """Entry point.

    Accepts an optional ``build_zips`` keyword for backwards-compatible
    programmatic calls (e.g. from tests).  When called from the CLI the
    argument is parsed via argparse instead.
    """
    if build_zips is not None:
        # Programmatic / test call — skip argparse, use caller's value.
        args = argparse.Namespace(
            zips=build_zips,
            thumb_size=96,
            thumb_quality=65,
            cdn_base="",
        )
    else:
        ap = argparse.ArgumentParser(description="HIBIKI catalogue + ZIP builder")
        ap.add_argument("--zips", action="store_true", help="Also build sharded ZIPs")
        ap.add_argument(
            "--thumb-size", type=int, default=96, metavar="N",
            help="Cover thumbnail dimension in px (default: 96)",
        )
        ap.add_argument(
            "--thumb-quality", type=int, default=65, metavar="Q",
            help="JPEG thumbnail quality 1-95 (default: 65)",
        )
        ap.add_argument(
            "--cdn-base", default="", metavar="URL",
            help="Base URL for audio — written into catalogue meta.media_base_url",
        )
        args = ap.parse_args()

    artists = []
    total_songs = 0

    if MUSIC.exists():
        for artist_dir in sorted(
            p for p in MUSIC.iterdir() if p.is_dir() and not p.name.startswith("_")
        ):
            entry, n = process_artist(artist_dir, args)
            if entry:
                artists.append(entry)
                total_songs += n

    contributors = []
    contrib_path = ROOT / "contributors.yaml"
    if contrib_path.exists() and yaml is not None:
        try:
            contributors = yaml.safe_load(contrib_path.read_text(encoding="utf-8")) or []
        except Exception:
            contributors = []

    meta_block: dict = {
        "total_songs": total_songs,
        "total_artists": len(artists),
        "built_at": datetime.now(timezone.utc).isoformat(),
        "contributors": contributors,
    }
    if args.cdn_base:
        meta_block["media_base_url"] = args.cdn_base.rstrip("/")

    catalogue = {"meta": meta_block, "artists": artists}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(catalogue, ensure_ascii=False, indent=2), encoding="utf-8")
    size_kb = round(OUT.stat().st_size / 1024)
    print(
        f"catalogue.json written: {len(artists)} artists, {total_songs} songs, "
        f"{size_kb} KB -> {OUT}"
    )
    # Sweep orphaned thumbs: every rebuild may produce a new hash (PIL
    # output isn't byte-stable across versions), so unreferenced files
    # in public/_thumbs/ would accumulate forever.
    thumbs_dir = ROOT / "public" / "_thumbs"
    if thumbs_dir.exists():
        referenced = {
            alb["cover_thumb"].split("/")[-1]
            for a in artists for alb in a.get("albums", [])
            if alb.get("cover_thumb")
        }
        removed = 0
        for f in thumbs_dir.iterdir():
            if f.is_file() and f.name not in referenced:
                f.unlink()
                removed += 1
        if removed:
            print(f"swept {removed} orphan thumb(s) from public/_thumbs/")
    no_cover = [
        f"  - {a['name']} / {alb['title']}"
        for a in artists for alb in a.get("albums", []) if not alb.get("cover_thumb")
    ]
    if no_cover:
        print(f"warning: {len(no_cover)} album(s) have no cover art — drop a cover.jpg in:")
        for line in no_cover:
            print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
