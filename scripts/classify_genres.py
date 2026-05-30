#!/usr/bin/env python3
"""
NEIRO 音色 — interactive genre classification helper.

Walks every album in _catalogue/catalogue.json whose genre is "Unknown"
and prompts the maintainer for a genre. Writes the chosen genres into
genres.yaml as overrides, which build_catalogue.py picks up on the
next rebuild.

Usage:
    python scripts/classify_genres.py            # walk Unknown albums
    python scripts/classify_genres.py --all      # walk every album (not just Unknown)
    python scripts/classify_genres.py --dry-run  # show what would be written

Use the same genre vocabulary as the Contribute form / lint_meta.py:
    Ambient, Electronic, Jazz, Classical, Rock, Folk, Field Recording,
    Pop, Hip-Hop, Soundtrack, Devotional, Lofi, Other

Type the genre, or just press Enter to skip an album. Ctrl-C saves
what you've done so far and exits.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("ERROR: pip install PyYAML", file=sys.stderr)
    sys.exit(2)

ROOT = Path(__file__).resolve().parent.parent
CATALOGUE = ROOT / "_catalogue" / "catalogue.json"
GENRES_YAML = ROOT / "genres.yaml"

KNOWN_GENRES = [
    "Ambient", "Electronic", "Jazz", "Classical", "Rock", "Folk",
    "Field Recording", "Pop", "Hip-Hop", "Soundtrack", "Devotional",
    "Lofi", "Other",
]


def load_existing() -> dict[str, str]:
    if not GENRES_YAML.exists():
        return {}
    raw = GENRES_YAML.read_text(encoding="utf-8")
    try:
        data = yaml.safe_load(raw) or {}
    except Exception:
        return {}
    return {str(k): str(v) for k, v in data.items() if v}


def save(overrides: dict[str, str]) -> None:
    header = (
        "# Genre overrides for albums whose meta.yaml / audio tags don't\n"
        "# supply a genre. build_catalogue.py reads this file as a low-\n"
        "# priority fallback — anything explicitly set in meta.yaml or\n"
        "# audio tags still wins. To force a different genre than the\n"
        "# tags suggest, edit meta.yaml directly.\n"
        "#\n"
        "# Format: album_id (from catalogue.json) → genre string.\n"
        "# Run `python scripts/classify_genres.py` to walk Unknown-genre\n"
        "# albums interactively.\n\n"
    )
    body = yaml.safe_dump(
        dict(sorted(overrides.items())),
        sort_keys=False,
        default_flow_style=False,
        allow_unicode=True,
    )
    GENRES_YAML.write_text(header + body, encoding="utf-8")


def prompt(album, current: str | None) -> str | None:
    """Returns the chosen genre or None to skip."""
    print()
    print(f"  Album:  {album['_artist']} / {album['title']}")
    print(f"  Tracks: {len(album.get('tracks', []))}, ID: {album['id']}")
    if current:
        print(f"  Currently set to: {current}")
    print(f"  Genres: {' · '.join(KNOWN_GENRES)}")
    try:
        choice = input("  > ").strip()
    except (EOFError, KeyboardInterrupt):
        raise
    if not choice:
        return None
    # Case-insensitive match
    for g in KNOWN_GENRES:
        if choice.lower() == g.lower():
            return g
    # Free-form accepted; warn if unknown
    print(f"  (note: '{choice}' isn't in the known set — will store as-is)")
    return choice


def main() -> int:
    ap = argparse.ArgumentParser(description="Classify album genres")
    ap.add_argument("--all", action="store_true",
                    help="Walk every album, not just Unknown ones")
    ap.add_argument("--dry-run", action="store_true",
                    help="Show what would change without writing genres.yaml")
    args = ap.parse_args()

    if not CATALOGUE.exists():
        print(f"ERROR: {CATALOGUE} missing — run scripts/build_catalogue.py first",
              file=sys.stderr)
        return 1
    cat = json.loads(CATALOGUE.read_text(encoding="utf-8"))
    existing = load_existing()

    targets = []
    for a in cat["artists"]:
        for alb in a.get("albums", []):
            alb["_artist"] = a["name"]
            g = alb.get("genre")
            if args.all or g in (None, "", "Unknown"):
                targets.append(alb)

    if not targets:
        print("No Unknown-genre albums — nothing to do.")
        return 0

    print(f"Classifying {len(targets)} album(s). Press Enter to skip, Ctrl-C to save & exit.")
    new = dict(existing)
    try:
        for alb in targets:
            existing_value = existing.get(alb["id"])
            chosen = prompt(alb, existing_value)
            if chosen:
                new[alb["id"]] = chosen
    except (EOFError, KeyboardInterrupt):
        print("\n[interrupted]")

    delta = {k: v for k, v in new.items() if existing.get(k) != v}
    if not delta:
        print("\nNo changes to genres.yaml.")
        return 0
    print(f"\n{len(delta)} new classification(s):")
    for k, v in sorted(delta.items()):
        print(f"  {k}: {v}")
    if args.dry_run:
        print("\n--dry-run set; genres.yaml not modified.")
        return 0
    save(new)
    print(f"\nWrote {len(new)} total entries to {GENRES_YAML}.")
    print("Next: python scripts/build_catalogue.py && git commit -am 'classify: genres'")
    return 0


if __name__ == "__main__":
    sys.exit(main())
