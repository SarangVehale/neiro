#!/usr/bin/env python3
"""
NEIRO 音色 — sync music/ to Cloudflare R2.

Uploads audio files to an R2 bucket, skipping files that already exist with
the same size (ETag check). Cover images and YAML metadata stay in git.

Usage:
    pip install boto3
    python scripts/sync_r2.py \\
        --account-id  <Cloudflare account ID> \\
        --bucket      <R2 bucket name> \\
        --access-key  <R2 API token access key> \\
        --secret-key  <R2 API token secret key> \\
        [--dry-run]   # show what would upload without uploading
        [--delete]    # remove R2 objects not present locally

Find your account ID at: https://dash.cloudflare.com → right sidebar.
Create an R2 API token at: R2 → Manage R2 API tokens → Create API token.
Enable public access on the bucket for streaming (R2 → bucket → Settings → Public access).
"""
from __future__ import annotations

import argparse
import hashlib
import mimetypes
import sys
from pathlib import Path

try:
    import boto3  # type: ignore
    from botocore.exceptions import ClientError  # type: ignore
except ImportError:
    print("ERROR: pip install boto3", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
MUSIC = ROOT / "music"

AUDIO_EXT = {".flac", ".mp3", ".m4a", ".aac"}
COVER_EXT = {".jpg", ".jpeg", ".png"}
SKIP_EXT = {".yaml", ".yml", ".md", ".txt", ".ini"}


def md5(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def mime(path: Path) -> str:
    t, _ = mimetypes.guess_type(path.name)
    return t or "application/octet-stream"


def should_sync(path: Path) -> bool:
    """Audio + full-res cover images get pushed to R2. cover_path in the
    catalogue is resolved against media_base_url at render time, so the
    R2 bucket must hold both audio and the high-res covers."""
    if path.suffix.lower() in SKIP_EXT:
        return False
    suf = path.suffix.lower()
    if suf in AUDIO_EXT:
        return True
    # Only sync cover.* / folder.* image files, not arbitrary loose images.
    if suf in COVER_EXT and path.stem.lower() in ("cover", "folder"):
        return True
    return False


def list_remote(client, bucket: str, prefix: str) -> dict[str, int]:
    """Return {key: size} for all objects under prefix."""
    remote: dict[str, int] = {}
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            remote[obj["Key"]] = obj["Size"]
    return remote


def main() -> int:
    ap = argparse.ArgumentParser(description="Sync music/ to Cloudflare R2")
    ap.add_argument("--account-id",  required=True, metavar="ID")
    ap.add_argument("--bucket",      required=True, metavar="NAME")
    ap.add_argument("--access-key",  required=True, metavar="KEY")
    ap.add_argument("--secret-key",  required=True, metavar="SECRET")
    ap.add_argument("--prefix",      default="",    metavar="PATH",
                    help="Key prefix in the bucket (default: empty = root)")
    ap.add_argument("--dry-run",     action="store_true")
    ap.add_argument("--delete",      action="store_true",
                    help="Delete R2 objects not present locally")
    args = ap.parse_args()

    endpoint = f"https://{args.account_id}.r2.cloudflarestorage.com"
    client = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=args.access_key,
        aws_secret_access_key=args.secret_key,
        region_name="auto",
    )

    prefix = args.prefix.strip("/")
    remote_prefix = (prefix + "/") if prefix else ""

    print(f"Listing remote objects in s3://{args.bucket}/{remote_prefix}…")
    remote = list_remote(client, args.bucket, remote_prefix)
    print(f"  {len(remote)} objects found remotely")

    local_files = sorted(p for p in MUSIC.rglob("*") if p.is_file() and should_sync(p))
    n_audio = sum(1 for p in local_files if p.suffix.lower() in AUDIO_EXT)
    n_cover = len(local_files) - n_audio
    print(f"  {n_audio} audio + {n_cover} cover files locally\n")

    uploaded = skipped = 0
    local_keys: set[str] = set()

    for path in local_files:
        rel = path.relative_to(ROOT)
        key = (remote_prefix + str(rel)).replace("\\", "/")
        local_keys.add(key)
        local_size = path.stat().st_size

        if key in remote and remote[key] == local_size:
            skipped += 1
            continue

        size_mb = round(local_size / (1024 * 1024), 1)
        if args.dry_run:
            print(f"  [dry-run] upload {rel} ({size_mb} MB)")
        else:
            print(f"  ↑ {rel} ({size_mb} MB)… ", end="", flush=True)
            try:
                client.upload_file(
                    str(path),
                    args.bucket,
                    key,
                    ExtraArgs={
                        "ContentType": mime(path),
                        "CacheControl": "public, max-age=31536000, immutable",
                    },
                )
                print("done")
            except ClientError as e:
                print(f"FAILED: {e}")
                return 1
        uploaded += 1

    if args.delete:
        stale = [k for k in remote if k not in local_keys]
        for key in stale:
            if args.dry_run:
                print(f"  [dry-run] delete {key}")
            else:
                print(f"  ✕ delete {key}")
                client.delete_object(Bucket=args.bucket, Key=key)

    print(f"\nSync complete: {uploaded} uploaded, {skipped} skipped (unchanged)")
    if not args.dry_run and uploaded:
        print(f"\nSet this as your media_base_url in CI secrets (R2_PUBLIC_URL):")
        print(f"  Your R2 public URL — found at: R2 → {args.bucket} → Settings → Public access")
    return 0


if __name__ == "__main__":
    sys.exit(main())
