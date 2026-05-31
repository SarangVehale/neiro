# R2 migration checklist

Step-by-step executable plan to move audio from Git LFS (currently 5.7 GB
of 10 GB free quota, no R2 secrets set) to Cloudflare R2. Run each block
in order from the repo root; **stop and verify after every block**.

If anything goes wrong before §5, the repo and the live site are
untouched — you can abort by deleting the local `music/**/tracks.yaml`
files and `--delete` the R2 prefix. §5 onward is harder to roll back; do
not do §6 (`git filter-repo`) until at least 7 days of live operation on
R2 confirm everything works.

Related: `docs/DEPLOY.md` (one-time R2 setup), `docs/OPERATIONS.md`
(rollback, SW bust, LFS quota response), `docs/AUDIT.md` §4.1 (LFS-on-
Pages constraint — anything under `public/` must stay a regular blob).

---

## 0. Pre-flight

```bash
# Local Python env (one-time; .venv is gitignored)
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt boto3

# Sanity: tracks.yaml count should be 0, audio count should be ~496
find music -name 'tracks.yaml' | wc -l
git ls-files 'music/**/*.m4a' 'music/**/*.mp3' 'music/**/*.flac' 'music/**/*.aac' | wc -l

# Sanity: live catalogue's media_base_url should still be the LFS CDN
curl -s https://sarangvehale.github.io/neiro/_catalogue/catalogue.json \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['meta'].get('media_base_url'))"
# expected: https://media.githubusercontent.com/media/SarangVehale/neiro/main
```

If `media_base_url` already points at an R2 URL, **stop** — migration is
already in progress and this checklist is stale.

---

## 1. Cloudflare R2 setup (one-time, manual)

Follow `docs/DEPLOY.md` §"One-time R2 setup" through step 6 (CORS). At
the end you should have these five values written down somewhere safe:

- `R2_ACCOUNT_ID` — Cloudflare account ID
- `R2_BUCKET` — bucket name (e.g. `neiro-music`)
- `R2_ACCESS_KEY_ID` — R2 API token access key
- `R2_SECRET_ACCESS_KEY` — R2 API token secret key
- `R2_PUBLIC_URL` — public hostname (e.g. `pub-xxxx.r2.dev`)

Do **not** add them to GitHub secrets yet — we want CI to keep using LFS
until §5.

---

## 2. Extract per-album metadata into `tracks.yaml`

Without this step, the catalogue can't be rebuilt once audio leaves
disk. `tracks.yaml` lets `build_catalogue.py` reconstruct an album entry
from cached metadata.

```bash
# Dry run first — should print one line per audio file, no writes
.venv/bin/python scripts/extract_metadata.py --dry-run | tail -20

# For real — writes music/<artist>/<album>/tracks.yaml
.venv/bin/python scripts/extract_metadata.py

# Sanity: every album dir now has a tracks.yaml
find music -name 'tracks.yaml' | wc -l    # expect ~45

# Verify the catalogue still builds from yaml (with audio still on disk)
.venv/bin/python scripts/build_catalogue.py | tail -3
```

Commit:

```bash
git add 'music/**/tracks.yaml'
git commit -m "feat: tracks.yaml for metadata-only catalogue build"
git push origin r2-migration-checklist
```

Wait for **Tests** workflow to pass. Do not merge yet.

---

## 3. Dry-run R2 sync

```bash
# Read-only check: what would be uploaded, no writes
.venv/bin/python scripts/sync_r2.py \
  --account-id  "$R2_ACCOUNT_ID" \
  --bucket      "$R2_BUCKET" \
  --access-key  "$R2_ACCESS_KEY_ID" \
  --secret-key  "$R2_SECRET_ACCESS_KEY" \
  --dry-run \
  | tee /tmp/r2-dryrun.log

# Sanity: line count ≈ audio file count
grep -c '^upload' /tmp/r2-dryrun.log    # expect ~496
```

If the dry-run errors with `AccessDenied` or `InvalidAccessKeyId`, the
R2 token is wrong — fix in Cloudflare dashboard and re-run.

---

## 4. Real R2 sync

```bash
.venv/bin/python scripts/sync_r2.py \
  --account-id  "$R2_ACCOUNT_ID" \
  --bucket      "$R2_BUCKET" \
  --access-key  "$R2_ACCESS_KEY_ID" \
  --secret-key  "$R2_SECRET_ACCESS_KEY"
```

5.7 GB upload — depending on uplink, 10 min – 2 h. The script is
idempotent (skips files whose size already matches in R2), so you can
re-run if it gets interrupted.

Verify a track is publicly fetchable:

```bash
curl -sI "https://$R2_PUBLIC_URL/music/Charlie%20Puth/Attention.m4a" | head -3
# expect: HTTP/2 200, content-type: audio/mp4
```

If the URL 403s, public access isn't enabled on the bucket — go back to
`DEPLOY.md` §"One-time R2 setup" step 3.

---

## 5. Cut over CI to R2

Add the five GitHub secrets:

```bash
# Using gh CLI (install with: pacman -S github-cli or sudo apt install gh)
gh secret set R2_ACCOUNT_ID         --body "$R2_ACCOUNT_ID"
gh secret set R2_BUCKET             --body "$R2_BUCKET"
gh secret set R2_ACCESS_KEY_ID      --body "$R2_ACCESS_KEY_ID"
gh secret set R2_SECRET_ACCESS_KEY  --body "$R2_SECRET_ACCESS_KEY"
gh secret set R2_PUBLIC_URL         --body "$R2_PUBLIC_URL"
```

Or set them manually under **Settings → Secrets and variables → Actions**.

Trigger a rebuild:

```bash
gh workflow run build.yml
# or push an empty commit:
git commit --allow-empty -m "chore: cut MEDIA_BASE over to R2"
git push origin r2-migration-checklist
```

After the workflow completes, verify on the **branch deploy preview** or
merge-to-main:

```bash
curl -s https://sarangvehale.github.io/neiro/_catalogue/catalogue.json \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['meta'].get('media_base_url'))"
# expected: https://<R2_PUBLIC_URL>
```

Open the live site, play a track end-to-end, confirm it streams from R2
(check Network panel — origin should be `*.r2.dev` or your custom CDN
host, not `media.githubusercontent.com`).

**Live site now serves audio from R2.** Audio in LFS is now redundant
but harmless. Stop here and run for a week before §6.

---

## 6. (Optional, deferred) Purge audio from git history

> Run this only after at least 7 days of stable R2 operation. This
> rewrites history and force-pushes — irreversible without a backup
> clone. Make one first: `git clone --mirror . /tmp/neiro-backup`.

```bash
# 1) Drop the cached LFS entries from the current tree
git rm --cached $(git ls-files 'music/**/*.m4a' 'music/**/*.mp3' \
                              'music/**/*.flac' 'music/**/*.aac')
git commit -m "chore: drop LFS-tracked audio from tree (now on R2)"

# 2) Rewrite history to remove the LFS objects entirely
pipx install git-filter-repo  # or: pip install --user git-filter-repo
git filter-repo \
  --path-glob '*.mp3' --path-glob '*.m4a' \
  --path-glob '*.flac' --path-glob '*.aac' \
  --invert-paths

# 3) Force-push (this is the irreversible step — backup first!)
git push --force-with-lease origin r2-migration-checklist
```

After the force-push, open a GitHub support ticket asking for LFS GC on
orphaned objects. They typically respond within a few business days.

---

## 7. Final verification + merge

Before merging this branch to `main`:

- [ ] `media_base_url` in deployed catalogue is the R2 URL.
- [ ] A track plays end-to-end on the live site, sourced from R2.
- [ ] `tracks.yaml` exists for every album dir.
- [ ] `python scripts/build_catalogue.py` succeeds **with audio removed
      from disk** (`mv music /tmp/music-stash`, build, restore). This
      proves CI can build without LFS.
- [ ] Tests workflow green on the branch.
- [ ] Build & Deploy workflow green on the branch.

Once merged, monitor for 24 h:

- Cloudflare R2 dashboard for unexpected egress (should stay near zero
  thanks to the CDN).
- GitHub Actions for any LFS bandwidth warnings (should stop appearing
  entirely).
- Live site error rate via the catalogue-failure banner not appearing
  for users.

---

## Rollback

| At step | Rollback action |
|---|---|
| 0–2 | Delete `music/**/tracks.yaml`; no remote impact. |
| 3 | Nothing to roll back — dry run is read-only. |
| 4 | `sync_r2.py --delete-prefix music/` to clear R2; bucket is unused at this point. |
| 5 | Remove the five `R2_*` secrets and re-deploy — `MEDIA_BASE` falls back to the LFS CDN automatically (the `if [[ -n ... ]]` branch in `build.yml`). Audio is still in LFS, still playable. |
| 6 | Restore from the mirror backup: `git push --force-with-lease origin r2-migration-checklist` from `/tmp/neiro-backup`. |

---

## What this checklist does NOT cover

- **Album cover migration to R2.** Thumbs and shell images stay in git
  (per `AUDIT.md` §4.1 — Pages doesn't resolve LFS, but it does serve
  regular blobs just fine). Originals in `music/<artist>/<album>/cover.jpg`
  follow the audio to R2 because they're path-adjacent.
- **`_zips/*.zip` shard downloads.** Currently in LFS. They're optional;
  the on-the-fly download path uses individual track fetches. Decide
  separately whether to also migrate ZIPs to R2 or drop them entirely.
- **CI building the catalogue.** Today the catalogue is pre-built
  locally and committed; CI just runs `inject_cdn.py`. Once `tracks.yaml`
  ships, you *could* move `build_catalogue.py` into CI and stop
  committing `_catalogue/catalogue.json`. Out of scope for this PR.
