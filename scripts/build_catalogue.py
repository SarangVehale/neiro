#!/usr/bin/env python3
"""
HIBIKI 響 — catalogue + ZIP builder (spec §2, §3).

Walks /music/<Artist>/<Album>/, reads ID3/MP4 tags (mutagen, optional),
honours meta.yaml / bio.md / artist.yaml overrides, extracts embedded cover
art as a base64 thumbnail, writes _catalogue/catalogue.json, and pre-builds
sharded iPod-structure ZIPs into _zips/.

Runs with zero third-party deps (graceful fallback to filename parsing);
mutagen + Pillow + PyYAML are used when present for richer output.

Usage:
    python scripts/build_catalogue.py           # catalogue only
    python scripts/build_catalogue.py --zips    # catalogue + sharded ZIPs

Environment:
    SHARD_THRESHOLD_MB  Albums above this size get split (default 150)
    SHARD_TARGET_MB     Target shard size (default 130)
"""
from __future__ import annotations

import base64
import io
import json
import os
import re
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

# ── optional deps ────────────────────────────────────────────
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
    """Return {title, number, duration_sec} using mutagen when available."""
    out: dict = {"title": None, "number": None, "duration_sec": 0}
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
                if getattr(mf, "info", None) and getattr(mf.info, "length", None):
                    out["duration_sec"] = int(mf.info.length)
        except Exception:
            pass
    # fallback: parse "01 - Title.ext"
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


def cover_thumb(album_dir: Path, artist_dir: Path) -> str | None:
    """Return a base64-encoded thumbnail from cover art, or None."""
    for d in (album_dir, artist_dir):
        for name in ("cover.jpg", "cover.jpeg", "cover.png"):
            p = d / name
            if p.exists():
                raw = p.read_bytes()
                if Image is not None:
                    try:
                        im = Image.open(io.BytesIO(raw)).convert("RGB")
                        im.thumbnail((320, 320))
                        buf = io.BytesIO()
                        im.save(buf, "JPEG", quality=78)
                        raw = buf.getvalue()
                    except Exception:
                        pass
                b64 = base64.b64encode(raw).decode("ascii")
                mime = "image/png" if p.suffix == ".png" else "image/jpeg"
                return f"data:{mime};base64,{b64}"
    return None


def shard_tracks(tracks: list[dict]) -> list[list[dict]]:
    """Group tracks into shards on track boundaries (spec §3).

    A track is never split across shards. Each shard is at most
    SHARD_TARGET_MB, subject to that constraint.
    """
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


def build_zip(artist: str, album: str, shard_tracks_: list[dict], label: str,
              album_dir: Path, artist_dir: Path) -> float:
    """Pre-build one iPod-structure ZIP into _zips/. Returns size in MB."""
    ZIPS.mkdir(parents=True, exist_ok=True)
    zname = f"{artist} - {album} [{label}].zip"
    zpath = ZIPS / zname
    readme = (
        f"{label}. Drag all parts into Music.app — they merge automatically.\n"
        f"{artist} — {album}\n"
    )
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_STORED) as z:
        folder = f"{artist}/{album}"
        for t in shard_tracks_:
            src = Path(t["_path"])
            arc = f"{folder}/{t['number']:02d} - {t['title']}.{t['format'].lower()}"
            if src.exists():
                z.write(src, arc)
        for d in (album_dir, artist_dir):
            for name in ("cover.jpg", "cover.jpeg", "cover.png"):
                cp = d / name
                if cp.exists():
                    z.write(cp, f"{folder}/cover.jpg")
                    break
        z.writestr(f"{folder}/README.txt", readme)
    return round(zpath.stat().st_size / (1024 * 1024), 1)


def main(build_zips: bool = False) -> int:
    artists = []
    total_songs = 0

    if MUSIC.exists():
        for artist_dir in sorted(
            p for p in MUSIC.iterdir() if p.is_dir() and not p.name.startswith("_")
        ):
            bio_path = artist_dir / "bio.md"
            bio = bio_path.read_text(encoding="utf-8").strip() if bio_path.exists() else ""
            ameta = load_yaml(artist_dir / "artist.yaml")
            albums = []

            for album_dir in sorted(p for p in artist_dir.iterdir() if p.is_dir()):
                audio = sorted(
                    p for p in album_dir.iterdir() if p.suffix.lower() in AUDIO_EXT
                )
                if not audio:
                    continue
                meta = load_yaml(album_dir / "meta.yaml")
                tracks = []
                for f in audio:
                    tags = read_tags(f)
                    size_mb = round(f.stat().st_size / (1024 * 1024), 1)
                    tracks.append({
                        "number": tags["number"] or (len(tracks) + 1),
                        "title": tags["title"],
                        "duration_sec": tags["duration_sec"],
                        "format": fmt_of(f),
                        "size_mb": size_mb,
                        "path": str(f.relative_to(ROOT)),
                        "_path": str(f),
                    })
                tracks.sort(key=lambda t: t["number"])
                total_mb = round(sum(t["size_mb"] for t in tracks), 1)
                groups = shard_tracks(tracks)
                shards = []
                for i, grp in enumerate(groups):
                    label = (
                        "Full album ZIP"
                        if len(groups) == 1
                        else f"Part {i+1} of {len(groups)}"
                    )
                    size_mb = (
                        build_zip(artist_dir.name, album_dir.name, grp, label,
                                  album_dir, artist_dir)
                        if build_zips
                        else round(sum(t["size_mb"] for t in grp), 1)
                    )
                    shards.append({
                        "label": label,
                        "path": f"_zips/{artist_dir.name} - {album_dir.name} [{label}].zip",
                        "size_mb": size_mb,
                    })
                albums.append({
                    "id": slug(f"{artist_dir.name}-{album_dir.name}"),
                    "title": meta.get("title", album_dir.name),
                    "year": meta.get("year"),
                    "genre": meta.get("genre", ameta.get("genre", "Unknown")),
                    "notes": meta.get("notes", ""),
                    "license": meta.get("license", ""),
                    "cover": cover_thumb(album_dir, artist_dir),
                    "total_size_mb": total_mb,
                    "shards": shards,
                    "tracks": [
                        {k: v for k, v in t.items() if not k.startswith("_")}
                        for t in tracks
                    ],
                })
                total_songs += len(tracks)

            if albums:
                artists.append({
                    "id": slug(artist_dir.name),
                    "name": artist_dir.name,
                    "kana": ameta.get("kana", ""),
                    "origin": ameta.get("origin", ""),
                    "genre": ameta.get("genre", ""),
                    "links": ameta.get("links", []),
                    "bio": bio,
                    "albums": albums,
                })

    # Load contributors from repo-root contributors.yaml
    contributors = []
    contrib_path = ROOT / "contributors.yaml"
    if contrib_path.exists() and yaml is not None:
        try:
            contributors = yaml.safe_load(contrib_path.read_text(encoding="utf-8")) or []
        except Exception:
            contributors = []

    catalogue = {
        "meta": {
            "total_songs": total_songs,
            "total_artists": len(artists),
            "built_at": datetime.now(timezone.utc).isoformat(),
            "contributors": contributors,
        },
        "artists": artists,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(catalogue, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"catalogue.json written: {len(artists)} artists, {total_songs} songs -> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main(build_zips="--zips" in sys.argv))
