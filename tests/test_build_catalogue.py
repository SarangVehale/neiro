"""Unit tests for scripts/build_catalogue.py."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))
import build_catalogue as bc  # noqa: E402


# ── slug ──────────────────────────────────────────────────────

@pytest.mark.parametrize("raw, expected", [
    ("Kaoru Tanaka", "kaoru-tanaka"),
    ("River Without Banks!", "river-without-banks"),
    ("Sapporo / Snow (2019)", "sapporo-snow-2019"),
    ("  spaced  out  ", "spaced-out"),
    ("under_score", "under-score"),
])
def test_slug(raw, expected):
    assert bc.slug(raw) == expected


# ── fmt_of ────────────────────────────────────────────────────

def test_fmt_of_uppercases_extension(tmp_path):
    p = tmp_path / "01 - foo.flac"
    p.write_bytes(b"x")
    assert bc.fmt_of(p) == "FLAC"


# ── read_tags filename fallback ───────────────────────────────

def test_read_tags_filename_fallback(tmp_path):
    p = tmp_path / "03 - Heron.flac"
    p.write_bytes(b"x")
    tags = bc.read_tags(p)
    assert tags["number"] == 3
    assert tags["title"] == "Heron"


def test_read_tags_unparseable_filename(tmp_path):
    p = tmp_path / "weird_name_no_number.flac"
    p.write_bytes(b"x")
    tags = bc.read_tags(p)
    assert tags["title"] == "weird_name_no_number"
    assert tags["number"] is None


# ── shard_tracks ──────────────────────────────────────────────

def _tracks(sizes):
    return [
        {"number": i + 1, "title": f"t{i+1}", "size_mb": s, "format": "FLAC"}
        for i, s in enumerate(sizes)
    ]


def test_shard_small_album_single_part(monkeypatch):
    monkeypatch.setattr(bc, "SHARD_THRESHOLD_MB", 150.0)
    monkeypatch.setattr(bc, "SHARD_TARGET_MB", 130.0)
    parts = bc.shard_tracks(_tracks([30, 40, 50]))
    assert len(parts) == 1
    assert sum(len(p) for p in parts) == 3


def test_shard_large_album_splits_on_track_boundaries(monkeypatch):
    monkeypatch.setattr(bc, "SHARD_THRESHOLD_MB", 150.0)
    monkeypatch.setattr(bc, "SHARD_TARGET_MB", 130.0)
    parts = bc.shard_tracks(_tracks([60] * 6))
    assert len(parts) == 3
    flat = [t for p in parts for t in p]
    assert [t["number"] for t in flat] == [1, 2, 3, 4, 5, 6]
    for p in parts:
        assert sum(t["size_mb"] for t in p) <= bc.SHARD_TARGET_MB + 60


def test_shard_never_splits_a_track(monkeypatch):
    monkeypatch.setattr(bc, "SHARD_THRESHOLD_MB", 150.0)
    monkeypatch.setattr(bc, "SHARD_TARGET_MB", 130.0)
    parts = bc.shard_tracks(_tracks([200]))
    assert len(parts) == 1 and len(parts[0]) == 1


# ── end-to-end: synthetic music tree ─────────────────────────

def test_main_end_to_end(tmp_path, monkeypatch):
    music = tmp_path / "music"
    album = music / "Test Artist" / "Test Album"
    album.mkdir(parents=True)
    (album / "01 - One.flac").write_bytes(b"\0" * 1024)
    (album / "02 - Two.flac").write_bytes(b"\0" * 1024)
    (tmp_path / "music" / "Test Artist" / "bio.md").write_text("A bio.")

    monkeypatch.setattr(bc, "ROOT", tmp_path)
    monkeypatch.setattr(bc, "MUSIC", music)
    monkeypatch.setattr(bc, "OUT", tmp_path / "_catalogue" / "catalogue.json")
    monkeypatch.setattr(bc, "ZIPS", tmp_path / "_zips")

    rc = bc.main(build_zips=False)
    assert rc == 0

    data = json.loads((tmp_path / "_catalogue" / "catalogue.json").read_text())
    assert data["meta"]["total_songs"] == 2
    assert data["meta"]["total_artists"] == 1
    a = data["artists"][0]
    assert a["name"] == "Test Artist"
    assert a["bio"] == "A bio."
    al = a["albums"][0]
    assert al["title"] == "Test Album"
    assert len(al["tracks"]) == 2
    assert al["tracks"][0]["number"] == 1
    assert al["tracks"][0]["title"] == "One"
    assert al["tracks"][0]["format"] == "FLAC"
    assert al["tracks"][0]["path"].endswith("01 - One.flac")
