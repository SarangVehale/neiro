# Setting up Internet Archive — step-by-step

Cold-tier backup for the music collection. Each album becomes an
Internet Archive *item* (`https://archive.org/details/neiro-<artist>-<album>`).
Audio + cover bytes live there forever as a passive failsafe.

IA is also the **primary backup target on every push**: a pre-push
hook (maintainer) and a CI workflow on push-to-main (everyone else)
mirror new audio to IA at commit time, decoupling backup from LFS
bandwidth quota.

Time required: **~10 minutes** for account work + hook install, then
**2–8 hours** for the initial 5.6 GB upload (let it run overnight).

---

## Quick check: do you already have an IA account?

If you've ever uploaded anything to archive.org, skip to §3.

---

## 1. Create the Internet Archive account

1. Open <https://archive.org/account/signup>.
2. Fill in:
   - **Screen name**: `neiro-music` (recommended — used in IA item URLs)
   - Email + password (use a password manager).
3. **Important — case sensitivity warning**: IA email login is
   case-sensitive. If you ever can't log in, that's why.
4. Check your inbox, confirm the email link.

---

## 2. Verify the account is in good standing

1. Log in at <https://archive.org/account/login>.
2. Visit <https://archive.org/account/profile> — should show your screen
   name `neiro-music`.
3. **One-time CAPTCHA test**: visit
   <https://archive.org/upload> in a logged-in browser, click any field.
   IA may require you to pass a CAPTCHA the first time. Do it once now
   so the script doesn't hit it later.

---

## 3. Get your S3 API keys (the script uses these, not the password)

These are different from the website password.

1. Log in, then visit <https://archive.org/account/s3.php>.
2. The page shows **Access Key** and **Secret Key**. They're permanent
   — generated automatically per account, not rotated.
3. Copy both. **Treat them like AWS credentials**.

Save them as:

```bash
export IA_ACCESS_KEY="..."
export IA_SECRET_KEY="..."
```

> Lost the secret? Hit **Reduce Access** + **Re-enable** on the same
> page — IA issues new keys. The old keys stop working.

---

## 4. Install the `ia` CLI locally + configure

```bash
cd /home/sarang/Development/neiro-music
.venv/bin/pip install internetarchive

# Configure interactively — writes ~/.config/internetarchive/ia.ini
.venv/bin/ia configure
# Email:    your@email
# Password: your IA password
```

Verify:

```bash
.venv/bin/ia whoami
# expect: your-screen-name (neiro-music)
```

> CI uses the S3 keys via env vars instead — see §8.

---

## 5. Install the pre-push hook (maintainer one-time)

The pre-push hook uploads new audio to IA from your laptop **before**
allowing `git push origin main`. This is the primary backup path; the
CI workflow (§8) is a safety net for PR merges and `--no-verify` pushes.

```bash
bash scripts/install_hooks.sh
```

This symlinks `scripts/git-hooks/pre-push` into `.git/hooks/pre-push`
(hooks aren't tracked by git, so each clone needs its own install).
The hook chains to `git lfs pre-push` after IA sync succeeds, so LFS
objects still get pushed normally.

### What the hook does

1. On `git push origin main`, diffs the commits being pushed for new
   or modified audio + cover files (under `music/**`).
2. Calls `scripts/sync_ia_delta.py` to upload them to IA from your
   local disk — no LFS bandwidth used.
3. If the upload fails (IA down, network out), copies the files to
   `~/neiro-backup/<utc-timestamp>/`, writes a manifest, and **blocks
   the push**. See §9 to recover.
4. If the upload succeeds, hands off to `git lfs pre-push` and the
   git push proceeds normally.

### Bypass for emergencies

```bash
git push --no-verify origin main
```

Skips the hook entirely; the CI workflow on the GitHub side will then
do the IA upload (using a small LFS bandwidth slice). Use sparingly.

### Pushes to other remotes

The hook only runs IA-upload for pushes to `origin`. Pushes to the
GitLab mirror (`git push gitlab`) skip IA entirely and just defer to
git-lfs — IA is already in sync from your earlier push to origin.

---

## 6. Dry-run the full sync first

Before doing the initial 5.6 GB push, validate the script + creds on
one small artist:

```bash
.venv/bin/python scripts/sync_archive_org.py --dry-run --only Pex
```

Expected:

```
Pex
  [dry-run] neiro-pex-singles: upload 2 file(s) (0 unchanged)
    ↑ music/Pex/Sanatani Phonk Pex X Pandits Full version - SouthMelody.mp3 (2.1 MB)
    ↑ music/Pex/cover.jpg (0.1 MB)

Done: 1 albums, 2 file(s) would upload, 0 unchanged
```

---

## 7. Real upload — small artist first, then everything

```bash
.venv/bin/python scripts/sync_archive_org.py --only Pex
sleep 60
curl -sI "https://archive.org/details/neiro-pex-singles" | head -3
# expect: HTTP/2 200
```

If that works, do the full library:

```bash
# 5.6 GB — runs ~2–8 hours depending on upload bandwidth.
# Safe to interrupt (Ctrl-C) and resume — size-based skip means
# already-uploaded files are not re-sent.
.venv/bin/python scripts/sync_archive_org.py
```

Run inside `tmux` / `screen` / `nohup` if your shell session might end:

```bash
nohup .venv/bin/python scripts/sync_archive_org.py \
  > /tmp/ia-sync.log 2>&1 &
tail -f /tmp/ia-sync.log
```

After this completes, the hook + CI workflow keep IA in sync from
here on — you should not need to run `sync_archive_org.py` again
except for full re-audits or large bulk imports.

---

## 8. CI secrets — enables on-push delta + monthly audit

```bash
gh secret set IA_ACCESS_KEY --body "$IA_ACCESS_KEY"
gh secret set IA_SECRET_KEY --body "$IA_SECRET_KEY"
```

Or under **Settings → Secrets and variables → Actions → Repository
secrets**.

> Do **not** add these as *environment secrets* (e.g., under the
> `github-pages` environment). The workflows don't declare an
> environment, so env-scoped secrets are invisible to them.

Two workflows consume these secrets:

| Workflow | When | What it does |
|---|---|---|
| `.github/workflows/ia-on-push.yml` | On every `push` to `main` that touches `music/**` | Sparse `git lfs pull` (only the changed files), upload to IA. Catches PR merges and `--no-verify` pushes. |
| `.github/workflows/archive-sync.yml` | Monthly cron + `workflow_dispatch` | **Audit only** — no LFS pull. Walks the catalogue, HEADs each IA item, fails the job if any album is missing or incomplete. |

Manual triggers:

```bash
gh workflow run ia-on-push.yml      # rare — push events trigger this
gh workflow run archive-sync.yml    # on-demand drift audit
gh workflow run archive-sync.yml -f verbose=true   # per-album OK lines
```

---

## 9. Drain a failed IA queue

When the pre-push hook can't reach IA, it leaves a backup at
`~/neiro-backup/<utc-timestamp>/` and writes the timestamp to
`.git/neiro-pending-ia`. **Future pushes are blocked** until that
queue drains.

### Inspect what's queued

```bash
.venv/bin/python scripts/drain_ia_queue.py --list
```

Shows per-queue commit, failure reason, and per-file state.

### Drain

```bash
.venv/bin/python scripts/drain_ia_queue.py          # drain every queue
.venv/bin/python scripts/drain_ia_queue.py --queue 2026-05-31T11-04-22Z   # one
```

Per-file state is tracked in `manifest.json`, so a partial drain
followed by a re-run only re-uploads the still-failing files (no
double-upload).

### Manifest layout

```
~/neiro-backup/2026-05-31T11-04-22Z/
├── manifest.json
└── music/
    └── Artist/
        └── Album/
            ├── 01-track.flac
            └── cover.jpg
```

```json
{
  "timestamp": "2026-05-31T11-04-22Z",
  "commit_being_pushed": "abc123...",
  "remote_branch": "refs/heads/main",
  "failure_reason": "...",
  "retry_command": "python scripts/drain_ia_queue.py",
  "files": [
    {"path": "music/.../01-track.flac", "size": 28491732, "sha256": "...", "status": "pending"}
  ]
}
```

The backup dir lives **outside the repo**, so `rm -rf neiro` or
`git reset --hard` won't touch it. If the laptop itself fails before
the queue drains, you've lost that batch — periodic rsync of
`~/neiro-backup/` to another machine is a sensible enhancement.

---

## 10. Contributor flow (PRs)

Contributors don't need to install anything. The standard PR flow
works:

1. Fork, branch, `git add music/Artist/Album/...`, push, open PR.
2. Maintainer reviews. Sharded PRs (≤ 1 GB per push, batched as
   one-album-per-PR) are easier to review.
3. On merge to `main`, `.github/workflows/ia-on-push.yml` fires:
   sparse LFS pull (proportional to the new audio), upload to IA.
4. The monthly audit (§8) confirms IA caught everything.

### Limits to communicate to contributors

- **Per-file**: GitHub rejects single files > 100 MiB outside LFS.
  Songs almost always fit; full uncompressed concert recordings may
  not.
- **Per-push**: GitHub recommends ≤ 1 GiB per push (2 GiB hard cap).
  Shard a multi-album contribution.

---

## 11. (Optional) Curate items under a collection

By default items go to `opensource_audio`. If you want a tidy
`https://archive.org/details/@neiro-music` landing page that lists
every album, no further action is needed — items uploaded by
`neiro-music` are already accessible there.

For a dedicated collection (with curator tools), email
**info@archive.org** asking them to create a community collection
called `neiro-music-archive`. Once it exists, set
`"collection": "neiro-music-archive"` in
`scripts/sync_archive_org.py` and re-run — existing items get the
new collection tag without re-uploading audio.

---

## Recovery — restoring from IA if LFS + GitLab both die

```bash
# List all your items
.venv/bin/ia search "uploader:neiro-music@archive.org" --itemlist > items.txt

# Download one album's files
.venv/bin/ia download neiro-pex-singles --destdir music/Pex/

# Bulk-download everything (slow — no parallelism via the CLI)
xargs -I{} .venv/bin/ia download {} --destdir restored/ < items.txt
```

Files come back as `restored/<identifier>/<original-filename>`. You'd
re-stage them into `music/<artist>/<album>/` and re-push.

> **Realistic expectation**: IA's per-item download bandwidth is
> ~5 MB/s. A full restore of 5.6 GB takes ~20 min once past the
> per-item HTTP overhead.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ia whoami` says "anonymous" | Re-run `ia configure` — credentials weren't saved |
| `400 BadRequest` on upload | Identifier collision — someone used `neiro-<artist>-<album>` first. Edit `IDENT_PREFIX` in `sync_archive_org.py` |
| Uploads succeed but item shows "dark" | IA flagged it for review. Email info@archive.org; usually resolved in 1–2 business days |
| `403 Forbidden` from CI | `IA_ACCESS_KEY` / `IA_SECRET_KEY` secret wrong, missing, or scoped to an environment instead of repo level (see §8) |
| Pre-push hook says "previous IA sync still queued" | Run `python scripts/drain_ia_queue.py` to clear the queue, then retry the push (§9) |
| Pre-push hook hangs forever | Likely IA's S3 endpoint timing out. Ctrl-C, check the backup queue under `~/neiro-backup/`, drain when IA recovers |
| `git push` succeeded but no IA upload happened | Either `--no-verify` was used, or the hook isn't installed. Run `bash scripts/install_hooks.sh` and re-push some test commit |
| Monthly audit reports "drift" | One or more albums missing/incomplete on IA. Inspect with `python scripts/sync_archive_org.py --dry-run --only ARTIST`, then real-run if needed |

Related: [SETUP_GITLAB_MIRROR.md](SETUP_GITLAB_MIRROR.md) for the
warm tier. [SETUP_R2.md](SETUP_R2.md) for the deferred hot tier.
