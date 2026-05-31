#!/usr/bin/env bash
# NEIRO 音色 — install local git hooks for this clone.
#
# .git/hooks/ is not tracked by git, so each clone must install hooks
# locally. This script symlinks scripts/git-hooks/* into .git/hooks/
# so future edits to the tracked hook source take effect immediately.
#
# Idempotent: safe to re-run.

set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel)
SRC_DIR="$REPO_ROOT/scripts/git-hooks"
DST_DIR="$REPO_ROOT/.git/hooks"

if [[ ! -d "$SRC_DIR" ]]; then
    echo "ERROR: $SRC_DIR not found" >&2
    exit 1
fi

mkdir -p "$DST_DIR"

installed=0
for hook in "$SRC_DIR"/*; do
    name=$(basename "$hook")
    [[ -d "$hook" ]] && continue
    target="$DST_DIR/$name"
    rel_src="../../scripts/git-hooks/$name"

    chmod +x "$hook"

    if [[ -L "$target" ]]; then
        existing=$(readlink "$target")
        if [[ "$existing" == "$rel_src" ]]; then
            echo "  ✓ $name (already linked)"
            continue
        fi
        echo "  ↻ $name (updating symlink: was $existing)"
        rm "$target"
    elif [[ -e "$target" ]]; then
        backup="$target.backup.$(date -u +%Y%m%dT%H%M%SZ)"
        echo "  ! $name exists and is not a symlink — moved to $backup"
        mv "$target" "$backup"
    fi

    ln -s "$rel_src" "$target"
    echo "  + $name → $rel_src"
    installed=$((installed + 1))
done

echo ""
echo "Hooks installed under $DST_DIR ($installed new/updated)."
