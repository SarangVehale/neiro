#!/usr/bin/env python3
"""
NEIRO 音色 — drain the pending Internet Archive upload queue.

When the pre-push hook fails to push files to IA (network, IA outage,
auth blip), it copies the affected audio + covers into
`~/neiro-backup/<utc-timestamp>/`, writes a manifest.json, appends the
timestamp to `.git/neiro-pending-ia`, and aborts the git push.

This script re-attempts each pending queue. On full success, the queue
directory is deleted and its timestamp removed from the marker file.
On partial success, per-file state is tracked in the manifest so the
next drain only re-uploads what's still pending.

Usage:
    python scripts/drain_ia_queue.py                 # drain everything
    python scripts/drain_ia_queue.py --list          # show queue state, no action
    python scripts/drain_ia_queue.py --queue TS     # drain one specific queue

    # Used by the pre-push hook on IA failure to build a queue entry:
    python scripts/drain_ia_queue.py --enqueue \\
        --commit <sha> --reason "<text>" --files-from <path>
"""
from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import os
import shutil
import sys
from pathlib import Path

from sync_archive_org import get_session
from sync_ia_delta import resolve_album

try:
    from sync_archive_org import sync_album_files  # noqa: F401
except ImportError:
    pass  # already guarded inside sync_archive_org

REPO = Path(__file__).resolve().parent.parent
BACKUP_ROOT = Path.home() / "neiro-backup"
PENDING_MARKER = REPO / ".git" / "neiro-pending-ia"


def read_pending() -> list[str]:
    if not PENDING_MARKER.exists():
        return []
    return [
        line.strip() for line in PENDING_MARKER.read_text().splitlines()
        if line.strip()
    ]


def write_pending(timestamps: list[str]) -> None:
    if not timestamps:
        if PENDING_MARKER.exists():
            PENDING_MARKER.unlink()
        return
    PENDING_MARKER.write_text("\n".join(timestamps) + "\n")


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def drain_one(ts: str) -> tuple[int, int]:
    """Drain queue at ~/neiro-backup/<ts>/. Returns (succeeded, still_failed)."""
    qdir = BACKUP_ROOT / ts
    manifest_path = qdir / "manifest.json"
    if not manifest_path.exists():
        print(f"  {ts}: manifest.json missing — skipping", file=sys.stderr)
        return 0, 0

    manifest = json.loads(manifest_path.read_text())
    entries = manifest.get("files", [])
    if not entries:
        return 0, 0

    # Lazy import — only authenticate if there's actual work
    from sync_archive_org import sync_album_files

    # Group pending entries by album (same logic as sync_ia_delta)
    pending_paths = []
    path_to_entry: dict[Path, dict] = {}
    for entry in entries:
        if entry.get("status") == "done":
            continue
        # Files are copied into qdir preserving repo-relative paths
        backup_file = qdir / entry["path"]
        if not backup_file.exists():
            entry["status"] = "missing"
            entry["error"] = "backup file vanished"
            continue
        # Optional integrity check
        expected = entry.get("sha256")
        if expected:
            actual = sha256_of(backup_file)
            if actual != expected:
                entry["status"] = "corrupt"
                entry["error"] = f"sha256 mismatch: expected {expected[:12]} got {actual[:12]}"
                continue
        pending_paths.append(backup_file)
        path_to_entry[backup_file] = entry

    if not pending_paths:
        # All entries done or unrecoverable
        if all(e.get("status") == "done" for e in entries):
            shutil.rmtree(qdir)
            return len([e for e in entries if e.get("status") == "done"]), 0
        manifest_path.write_text(json.dumps(manifest, indent=2))
        broken = [e for e in entries if e.get("status") in ("missing", "corrupt")]
        return 0, len(broken)

    # Group by album dir — but album resolution is keyed off the
    # backup-dir copy, not the original repo path. Resolve via the
    # repo-relative path stored in the manifest so album metadata
    # (artist.yaml etc.) is read from the live repo.
    grouped: dict[Path, tuple[Path, str, list[Path]]] = {}
    for backup_file in pending_paths:
        entry = path_to_entry[backup_file]
        repo_path = REPO / entry["path"]
        meta = resolve_album(repo_path)
        if meta is None:
            entry["status"] = "unresolved"
            entry["error"] = "path no longer resolves to an album"
            continue
        artist_dir, album_dir, album_name = meta
        if album_dir not in grouped:
            grouped[album_dir] = (artist_dir, album_name, [])
        grouped[album_dir][2].append(backup_file)

    succeeded = 0
    still_failed = 0
    for album_dir in sorted(grouped):
        artist_dir, album_name, files = grouped[album_dir]
        print(f"  → {artist_dir.name} / {album_name} ({len(files)} file(s))")
        u, s, failed = sync_album_files(
            artist_dir, album_dir, album_name, sorted(files),
            dry_run=False, collection=None,
        )
        # Mark each entry done or still-failed
        failed_set = set(failed)
        for f in files:
            entry = path_to_entry[f]
            if f in failed_set:
                entry["status"] = "failed"
                entry["error"] = "IA upload failed (see stderr)"
                still_failed += 1
            else:
                entry["status"] = "done"
                succeeded += 1

    # Persist manifest with updated per-entry status
    manifest_path.write_text(json.dumps(manifest, indent=2))

    if all(e.get("status") == "done" for e in entries):
        shutil.rmtree(qdir)
        print(f"  {ts}: all {succeeded} files uploaded — queue cleared.")
    else:
        print(f"  {ts}: {succeeded} succeeded, {still_failed} still failing — "
              "queue kept for retry.")
    return succeeded, still_failed


def cmd_enqueue(commit: str, reason: str, files_from: str) -> int:
    """Create a new pending-IA queue entry. Called by the pre-push hook."""
    src = sys.stdin if files_from == "-" else open(files_from)
    rel_paths = [line.strip() for line in src if line.strip()]
    if files_from != "-":
        src.close()
    if not rel_paths:
        print("ERROR: --enqueue called with no input files", file=sys.stderr)
        return 1

    ts = _dt.datetime.utcnow().strftime("%Y-%m-%dT%H-%M-%SZ")
    qdir = BACKUP_ROOT / ts
    qdir.mkdir(parents=True, exist_ok=True)

    entries: list[dict] = []
    for rel in rel_paths:
        src_path = REPO / rel
        if not src_path.is_file():
            print(f"WARN: skipping missing path: {rel}", file=sys.stderr)
            continue
        dst = qdir / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src_path, dst)
        size = src_path.stat().st_size
        sha = sha256_of(src_path)
        entries.append({
            "path": rel,
            "size": size,
            "sha256": sha,
            "status": "pending",
        })

    manifest = {
        "timestamp": ts,
        "commit_being_pushed": commit,
        "remote_branch": "refs/heads/main",
        "failure_reason": reason,
        "retry_command": "python scripts/drain_ia_queue.py",
        "files": entries,
    }
    (qdir / "manifest.json").write_text(json.dumps(manifest, indent=2))

    # Append to pending marker
    PENDING_MARKER.parent.mkdir(parents=True, exist_ok=True)
    with PENDING_MARKER.open("a") as f:
        f.write(ts + "\n")

    print(str(qdir))  # stdout: the queue path, for hook to surface
    return 0


def cmd_list() -> int:
    pending = read_pending()
    if not pending:
        print("No pending queues.")
        return 0
    print(f"{len(pending)} pending queue(s) in {BACKUP_ROOT}:\n")
    for ts in pending:
        qdir = BACKUP_ROOT / ts
        manifest_path = qdir / "manifest.json"
        if not manifest_path.exists():
            print(f"  {ts}: manifest missing ({qdir})")
            continue
        m = json.loads(manifest_path.read_text())
        files = m.get("files", [])
        done = sum(1 for e in files if e.get("status") == "done")
        failed = sum(1 for e in files if e.get("status") == "failed")
        pending_n = sum(1 for e in files if e.get("status", "pending") == "pending")
        reason = m.get("failure_reason", "?")
        print(f"  {ts}")
        print(f"    commit: {m.get('commit_being_pushed', '?')[:12]}")
        print(f"    reason: {reason}")
        print(f"    files:  {len(files)} total — {done} done, {failed} failed, "
              f"{pending_n} pending")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Drain pending IA upload queue")
    ap.add_argument("--list", action="store_true",
                    help="Show queue state without uploading")
    ap.add_argument("--queue", default=None, metavar="TIMESTAMP",
                    help="Drain only this queue directory (e.g. 2026-05-31T11-04-22Z)")
    ap.add_argument("--enqueue", action="store_true",
                    help="Build a new queue entry (used by the pre-push hook)")
    ap.add_argument("--commit", default="", help="(enqueue) HEAD sha being pushed")
    ap.add_argument("--reason", default="", help="(enqueue) human-readable failure reason")
    ap.add_argument("--files-from", default=None, metavar="PATH",
                    help="(enqueue) newline-separated repo-relative paths; '-' for stdin")
    args = ap.parse_args()

    if args.enqueue:
        if not args.files_from:
            print("ERROR: --enqueue requires --files-from", file=sys.stderr)
            return 2
        return cmd_enqueue(args.commit or "unknown",
                           args.reason or "(no reason given)",
                           args.files_from)

    if args.list:
        return cmd_list()

    if not BACKUP_ROOT.exists():
        print("No backup directory — nothing to drain.")
        return 0

    pending = read_pending()
    if args.queue:
        if args.queue not in pending:
            print(f"WARN: {args.queue} not in pending marker; trying anyway.",
                  file=sys.stderr)
            pending = [args.queue]
        else:
            pending = [args.queue]
    if not pending:
        # Pending marker absent — but maybe there are orphan queue dirs?
        orphans = [
            p.name for p in BACKUP_ROOT.iterdir()
            if p.is_dir() and (p / "manifest.json").exists()
        ] if BACKUP_ROOT.exists() else []
        if orphans:
            print(f"No pending marker, but found orphan queues: {orphans}")
            print("Re-add them to .git/neiro-pending-ia or drain with --queue.")
        else:
            print("Nothing to drain.")
        return 0

    # Pre-flight: auth check
    access = os.environ.get("IA_ACCESS_KEY")
    secret = os.environ.get("IA_SECRET_KEY")
    if not (access and secret):
        try:
            get_session().get_auth_config()
        except Exception:
            print("ERROR: IA credentials missing. Run `ia configure` or set "
                  "IA_ACCESS_KEY + IA_SECRET_KEY.", file=sys.stderr)
            return 2

    print(f"Found {len(pending)} pending queue(s).\n")
    total_ok = total_fail = 0
    still_pending: list[str] = []
    for i, ts in enumerate(pending, 1):
        print(f"[{i}/{len(pending)}] {ts}")
        ok, fail = drain_one(ts)
        total_ok += ok
        total_fail += fail
        if fail > 0 or (BACKUP_ROOT / ts).exists():
            still_pending.append(ts)

    write_pending(still_pending)

    print(f"\nResult: {total_ok} file(s) uploaded, {total_fail} still failing.")
    if still_pending:
        print(f"{len(still_pending)} queue(s) remain. Re-run after IA recovers.")
        return 1
    print("All queues drained. Push allowed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
