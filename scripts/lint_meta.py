#!/usr/bin/env python3
"""
NEIRO 音色 — lint meta.yaml files.

Validates the small schema that build_catalogue.py reads, detects the most
common authoring mistakes, and prints a one-line fix for each issue. Used
by .github/workflows/validate-pr.yml's bot comment so contributors get
actionable feedback on their PR instead of a stack trace.

Usage:
    python scripts/lint_meta.py [PATH ...]

If no paths are given, lints every meta.yaml under music/.

Exit code:
    0 — no errors (warnings allowed)
    1 — at least one error (PR should not merge)
"""
from __future__ import annotations

import argparse
import datetime as _dt
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("ERROR: pip install PyYAML", file=sys.stderr)
    sys.exit(2)

ROOT = Path(__file__).resolve().parent.parent

# Schema knowledge — kept in sync with build_catalogue.py's meta.get(...) calls.
REQUIRED = {"title", "year", "genre", "license"}
OPTIONAL = {"notes", "source"}
KNOWN_GENRES = {
    "Ambient", "Electronic", "Jazz", "Classical", "Rock", "Folk",
    "Field Recording", "Pop", "Hip-Hop", "Soundtrack", "Devotional",
    "Lofi", "Other",
}
# License strings we recognise — others get a warning but aren't an error.
KNOWN_LICENSES = {
    "CC-BY-4.0", "CC-BY-SA-4.0", "CC-BY-NC-4.0", "CC-BY-NC-SA-4.0",
    "CC-BY-ND-4.0", "CC0-1.0", "Public Domain", "All Rights Reserved",
}


class Issue:
    __slots__ = ("path", "severity", "line", "msg", "fix")

    def __init__(self, path: Path, severity: str, line: int | None,
                 msg: str, fix: str | None = None):
        self.path = path
        self.severity = severity
        self.line = line
        self.msg = msg
        self.fix = fix

    def as_markdown(self) -> str:
        head = f"**{self.severity.upper()}** `{self.path}`"
        if self.line is not None:
            head += f" line {self.line}"
        body = f"  - {self.msg}"
        if self.fix:
            body += f"\n  - Fix: `{self.fix}`"
        return head + "\n" + body


def _detect_unquoted_colon(text: str) -> list[tuple[int, str, str]]:
    """Find lines like `title: Foo: Bar` where the value contains an
    unquoted `: ` (colon followed by space — YAML's mapping separator).

    Returns (line_number, key, raw_value). PyYAML treats this as nested
    mapping and emits a confusing error; we surface a one-line fix.
    """
    out = []
    # Match: key, then ": ", then a value that starts with a non-quote and
    # contains another ": " somewhere.
    pat = re.compile(r"^(\s*)([A-Za-z_][\w-]*)\s*:\s+([^\s\"'\[\{].*?:\s.*)$")
    for i, line in enumerate(text.splitlines(), 1):
        if line.lstrip().startswith("#"):
            continue
        m = pat.match(line)
        if m:
            key, val = m.group(2), m.group(3).rstrip()
            out.append((i, key, val))
    return out


def lint_file(path: Path) -> list[Issue]:
    issues: list[Issue] = []
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return [Issue(path, "error", None,
                     "file is not valid UTF-8",
                     fix="re-save as UTF-8 (most editors have an encoding menu)")]

    # 1. Pre-parse: hunt for the unquoted-colon pattern before PyYAML
    #    barfs with a cryptic error.
    for ln, key, val in _detect_unquoted_colon(text):
        quoted = '"' + val.replace('"', '\\"') + '"'
        issues.append(Issue(
            path, "error", ln,
            f"value for `{key}` contains a colon — YAML reads this as nested mapping",
            fix=f'{key}: {quoted}',
        ))

    # 2. PyYAML parse
    try:
        data = yaml.safe_load(text) or {}
    except yaml.YAMLError as e:
        # Try to recover a line number from the mark
        ln = getattr(getattr(e, "problem_mark", None), "line", None)
        if ln is not None:
            ln = ln + 1
        issues.append(Issue(
            path, "error", ln,
            f"YAML parse failed: {str(e).splitlines()[0]}",
            fix="check the line(s) above for unquoted special chars (`:`, `#`, `&`, `*`)",
        ))
        return issues

    if not isinstance(data, dict):
        issues.append(Issue(
            path, "error", 1,
            "top level must be a mapping (`key: value` pairs)",
            fix="remove leading `-` if you have a list at the top",
        ))
        return issues

    keys = set(data.keys())

    # 3. Required fields
    for k in sorted(REQUIRED - keys):
        issues.append(Issue(
            path, "error", None,
            f"required field `{k}` is missing",
            fix={
                "title":   "title: Your Album Title",
                "year":    "year: 2024",
                "genre":   "genre: Ambient",
                "license": "license: CC-BY-4.0",
            }.get(k, f"{k}: ..."),
        ))

    # 4. Unknown keys — warn (typo catcher)
    unknown = keys - REQUIRED - OPTIONAL
    for k in sorted(unknown):
        suggestion = _suggest_key(k, REQUIRED | OPTIONAL)
        msg = f"unknown field `{k}`"
        if suggestion:
            msg += f" — did you mean `{suggestion}`?"
        issues.append(Issue(path, "warning", None, msg))

    # 5. Per-field validation
    if "title" in data and (data["title"] is None or not str(data["title"]).strip()):
        issues.append(Issue(path, "error", None,
                            "`title` is empty",
                            fix="title: Your Album Title"))
    if "year" in data:
        y = data["year"]
        this_year = _dt.date.today().year
        if not isinstance(y, int) or y < 1900 or y > this_year + 1:
            issues.append(Issue(
                path, "error", None,
                f"`year` should be a 4-digit number between 1900 and {this_year + 1} (got {y!r})",
                fix=f"year: {this_year}",
            ))
    if "genre" in data:
        g = str(data["genre"]).strip()
        if not g:
            issues.append(Issue(path, "error", None, "`genre` is empty",
                                fix="genre: Ambient"))
        elif g not in KNOWN_GENRES:
            suggestion = _suggest_key(g, KNOWN_GENRES)
            msg = f"unknown genre `{g}` — known genres: {', '.join(sorted(KNOWN_GENRES))}"
            if suggestion:
                msg += f" (did you mean `{suggestion}`?)"
            issues.append(Issue(path, "warning", None, msg))
    if "license" in data:
        lic = str(data["license"]).strip()
        if not lic:
            issues.append(Issue(path, "error", None, "`license` is empty",
                                fix="license: CC-BY-4.0"))
        elif lic not in KNOWN_LICENSES:
            issues.append(Issue(
                path, "warning", None,
                f"`license` value `{lic}` isn't in the known set — confirm it's correct. "
                f"Common values: {', '.join(sorted(KNOWN_LICENSES))}",
            ))

    return issues


def _suggest_key(s: str, candidates) -> str | None:
    """Tiny Damerau-Levenshtein-ish suggestion. Returns the best candidate
    within edit distance 2, or None."""
    s_low = s.lower()
    best = (None, 99)
    for c in candidates:
        d = _edit_distance(s_low, c.lower())
        if d < best[1]:
            best = (c, d)
    return best[0] if best[1] <= 2 else None


def _edit_distance(a: str, b: str) -> int:
    if a == b: return 0
    if not a: return len(b)
    if not b: return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, cb in enumerate(b, 1):
            cost = 0 if ca == cb else 1
            cur[j] = min(cur[j-1] + 1, prev[j] + 1, prev[j-1] + cost)
        prev = cur
    return prev[-1]


def main() -> int:
    ap = argparse.ArgumentParser(description="Lint meta.yaml files")
    ap.add_argument("paths", nargs="*", type=Path,
                    help="Paths to meta.yaml files (default: all under music/)")
    ap.add_argument("--format", choices=("text", "markdown"), default="text",
                    help="Output format")
    args = ap.parse_args()

    paths = args.paths or list((ROOT / "music").rglob("meta.yaml"))
    if not paths:
        print("no meta.yaml files to lint", file=sys.stderr)
        return 0

    all_issues: list[Issue] = []
    for p in paths:
        all_issues.extend(lint_file(p))

    errors = [i for i in all_issues if i.severity == "error"]
    warnings = [i for i in all_issues if i.severity == "warning"]

    if args.format == "markdown":
        if errors:
            print("### meta.yaml errors\n")
            for i in errors:
                print(i.as_markdown())
                print()
        if warnings:
            print("### meta.yaml warnings\n")
            for i in warnings:
                print(i.as_markdown())
                print()
        if not all_issues:
            print(f"✅ {len(paths)} meta.yaml file(s) — all clean")
    else:
        for i in all_issues:
            head = f"{i.path}"
            if i.line is not None:
                head += f":{i.line}"
            print(f"{head}: {i.severity}: {i.msg}")
            if i.fix:
                print(f"    fix: {i.fix}")
        if not all_issues:
            print(f"OK — {len(paths)} meta.yaml file(s), no issues")

    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
