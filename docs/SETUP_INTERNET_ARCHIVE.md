# Setting up Internet Archive — step-by-step

Cold-tier backup for the music collection. Each album becomes an
Internet Archive *item* (`https://archive.org/details/neiro-<artist>-<album>`).
Audio + cover bytes live there forever as a passive failsafe — only
consulted if R2 + LFS both die.

Time required: **~10 minutes** for the account work, then **2–8 hours**
for the initial 5.6 GB upload (let it run overnight).

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

1. Log in, then visit <https://archive.org/account/s3.php>
   (the URL is stable; bookmark it).
2. The page shows **Access Key** and **Secret Key**. They're permanent
   — generated automatically per account, not rotated.
3. Copy both. **Treat them like AWS credentials** — they let anyone
   upload to your IA account.

Save them as:

```bash
export IA_ACCESS_KEY="..."   # ~16 chars
export IA_SECRET_KEY="..."   # ~16 chars
```

> Lost the secret? Hit **Reduce Access** + **Re-enable** on the same
> page — IA issues new keys. The old keys stop working.

---

## 4. Install the `ia` CLI locally + configure

```bash
cd /home/sarang/Development/hibiki-music
.venv/bin/pip install internetarchive   # already done if you ran §0 of R2 migration

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

> The `configure` step stores your **password** in `ia.ini`, not the S3
> keys. That's fine for local use. CI uses the S3 keys via environment
> variables instead — see §7.

---

## 5. Dry-run first — see what would upload

```bash
# Test on one small artist (Pex = 1 track, 2 MB)
.venv/bin/python scripts/sync_archive_org.py --dry-run --only Pex
```

Expected output:

```
Pex
  [dry-run] neiro-pex-singles: upload 2 file(s) (0 unchanged)
    ↑ music/Pex/Sanatani Phonk Pex X Pandits Full version - SouthMelody.mp3 (2.1 MB)
    ↑ music/Pex/cover.jpg (0.1 MB)

Done: 1 albums, 2 file(s) would upload, 0 unchanged
```

If you see this, the script + creds are working.

---

## 6. Real upload — small artist first, then everything

```bash
# Push one album to verify end-to-end (~30s)
.venv/bin/python scripts/sync_archive_org.py --only Pex
```

Check it live:

```bash
sleep 60  # IA takes ~1 min to ingest the item
curl -sI "https://archive.org/details/neiro-pex-singles" | head -3
# expect: HTTP/2 200
```

Or open <https://archive.org/details/neiro-pex-singles> in a browser.
You should see the audio + cover.

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

---

## 7. Add CI secrets — enables the monthly cron

```bash
# Once gh CLI is installed (see SETUP_R2.md §9):
gh secret set IA_ACCESS_KEY --body "$IA_ACCESS_KEY"
gh secret set IA_SECRET_KEY --body "$IA_SECRET_KEY"
```

Or manually under **Settings → Secrets and variables → Actions**.

The workflow `.github/workflows/archive-sync.yml` will fire on the 7th
of every month and push only deltas. You can also run it on demand:

```bash
gh workflow run archive-sync.yml
# or with a dry-run / single-artist filter:
gh workflow run archive-sync.yml -f dry_run=true
gh workflow run archive-sync.yml -f only_artist="Lana Del Rey"
```

---

## 8. (Optional) Curate items under a collection

By default items go to `opensource_audio`, IA's permissive public
audio collection. They're public but not grouped under your account.

If you want a tidy `https://archive.org/details/@neiro-music` landing
page that lists every album:

1. Items uploaded by `neiro-music` are already accessible at
   <https://archive.org/details/@neiro-music>.
2. For a dedicated collection (with curator tools), email
   **info@archive.org** asking them to create a community collection
   called `neiro-music-archive`. Mention you want to upload ~45 albums
   you have rights to.
3. Once they create it, edit `scripts/sync_archive_org.py`:
   change `"collection": "opensource_audio"` → `"collection": "neiro-music-archive"`.
4. Re-run `sync_archive_org.py` — existing items get the new collection
   tag without re-uploading audio.

This step is **completely optional** — `opensource_audio` works fine as
a backup destination forever.

---

## Recovery — restoring from IA if R2 + LFS both die

```bash
# List all your items
.venv/bin/ia search "uploader:neiro-music@archive.org" --itemlist > items.txt

# Download one album's files
.venv/bin/ia download neiro-pex-singles --destdir music/Pex/

# Bulk-download everything (slow — there's no parallelism via the CLI)
xargs -I{} .venv/bin/ia download {} --destdir restored/ < items.txt
```

Files come back as `restored/<identifier>/<original-filename>`. You'd
re-stage them into `music/<artist>/<album>/` and re-run
`scripts/sync_r2.py` to repopulate R2.

> **Realistic expectation**: IA's per-item download bandwidth is
> ~5 MB/s. A full restore of 5.6 GB takes ~20 min once you're past
> the per-item HTTP overhead. Plan accordingly during an actual
> incident.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ia whoami` says "anonymous" | Re-run `ia configure` — credentials weren't saved |
| `400 BadRequest` on upload | Identifier collision — someone else used `neiro-<artist>-<album>` first. Edit `IDENT_PREFIX` in `sync_archive_org.py` to something more unique |
| Uploads succeed but item shows "dark" | IA flagged it for review. Email info@archive.org; usually resolved in 1–2 business days |
| `403 Forbidden` from CI | `IA_ACCESS_KEY` or `IA_SECRET_KEY` GH secret is wrong/missing |
| Upload extremely slow | IA's S3 endpoint is rate-limited per IP; the script retries 3x. If still slow, run from home (residential IPs often unthrottled) instead of a VPS |

Related: [SETUP_R2.md](SETUP_R2.md) for the hot tier.
