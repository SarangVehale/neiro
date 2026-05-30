"""Unit tests for scripts/lint_meta.py."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))
import lint_meta as lm  # noqa: E402


def write(tmp_path: Path, content: str) -> Path:
    p = tmp_path / "meta.yaml"
    p.write_text(content, encoding="utf-8")
    return p


# ── happy path ──────────────────────────────────────────────────

def test_valid_meta_no_issues(tmp_path):
    p = write(tmp_path, """\
title: Test Album
year: 2024
genre: Ambient
license: CC-BY-4.0
notes: A simple test.
""")
    issues = lm.lint_file(p)
    assert issues == []


# ── unquoted colon ──────────────────────────────────────────────

def test_unquoted_colon_in_title(tmp_path):
    p = write(tmp_path, """\
title: Album: Subtitle
year: 2024
genre: Ambient
license: CC-BY-4.0
""")
    issues = lm.lint_file(p)
    colon_errs = [i for i in issues if "colon" in i.msg]
    assert colon_errs, "should flag the unquoted colon"
    assert colon_errs[0].fix == 'title: "Album: Subtitle"'


def test_colon_without_following_space_is_ok(tmp_path):
    """Time-of-day like 4:12 is valid YAML — don't false-flag it."""
    p = write(tmp_path, """\
title: Test Album
year: 2024
genre: Ambient
license: CC-BY-4.0
notes: The hum at 4:12 is the heater.
""")
    issues = lm.lint_file(p)
    assert not any("colon" in i.msg for i in issues), \
        f"4:12 should not trigger; got {[i.msg for i in issues]}"


# ── required fields ─────────────────────────────────────────────

def test_missing_license_is_error(tmp_path):
    p = write(tmp_path, """\
title: Test
year: 2024
genre: Ambient
""")
    issues = lm.lint_file(p)
    err = [i for i in issues if "license" in i.msg and i.severity == "error"]
    assert err
    assert err[0].fix == "license: CC-BY-4.0"


def test_all_required_fields_must_be_present(tmp_path):
    p = write(tmp_path, "title: Test\n")
    issues = lm.lint_file(p)
    missing = [i.msg for i in issues if i.severity == "error" and "missing" in i.msg]
    assert any("year" in m for m in missing)
    assert any("genre" in m for m in missing)
    assert any("license" in m for m in missing)


# ── typo detection ──────────────────────────────────────────────

def test_typo_in_key_suggests_correction(tmp_path):
    p = write(tmp_path, """\
title: Test
year: 2024
genre: Ambient
licens: CC-BY-4.0
""")
    issues = lm.lint_file(p)
    warns = [i for i in issues if i.severity == "warning"]
    assert any("licens" in w.msg and "license" in w.msg for w in warns)


def test_unknown_genre_suggests_closest(tmp_path):
    p = write(tmp_path, """\
title: Test
year: 2024
genre: Lo-Fi
license: CC-BY-4.0
""")
    issues = lm.lint_file(p)
    warns = [i for i in issues if i.severity == "warning" and "genre" in i.msg]
    assert warns
    assert "Lofi" in warns[0].msg


# ── per-field validation ────────────────────────────────────────

def test_year_must_be_in_range(tmp_path):
    p = write(tmp_path, """\
title: Test
year: 1850
genre: Ambient
license: CC-BY-4.0
""")
    issues = lm.lint_file(p)
    assert any("year" in i.msg and i.severity == "error" for i in issues)


def test_year_string_is_error(tmp_path):
    p = write(tmp_path, """\
title: Test
year: nineteen ninety
genre: Ambient
license: CC-BY-4.0
""")
    issues = lm.lint_file(p)
    assert any("year" in i.msg and i.severity == "error" for i in issues)


def test_empty_title_is_error(tmp_path):
    p = write(tmp_path, """\
title:
year: 2024
genre: Ambient
license: CC-BY-4.0
""")
    issues = lm.lint_file(p)
    assert any("title" in i.msg and "empty" in i.msg for i in issues)


# ── broken yaml ─────────────────────────────────────────────────

def test_broken_yaml_returns_error(tmp_path):
    p = write(tmp_path, "title: [unclosed\n")
    issues = lm.lint_file(p)
    assert any("YAML parse failed" in i.msg for i in issues)


def test_top_level_must_be_mapping(tmp_path):
    p = write(tmp_path, "- one\n- two\n")
    issues = lm.lint_file(p)
    assert any("mapping" in i.msg for i in issues)


# ── edit distance ──────────────────────────────────────────────

def test_edit_distance_basics():
    assert lm._edit_distance("license", "license") == 0
    assert lm._edit_distance("licens", "license") == 1
    assert lm._edit_distance("xyz", "license") > 5


def test_suggest_key_returns_none_for_far_match():
    assert lm._suggest_key("xyzabc", {"license", "title"}) is None
    assert lm._suggest_key("licens", {"license", "title"}) == "license"
