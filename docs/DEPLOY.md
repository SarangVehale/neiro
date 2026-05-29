# Deploying HIBIKI

## First-time setup

1. **Enable GitHub Pages** (Settings → Pages):
   - Source: **GitHub Actions** (not "Deploy from a branch").
   - Push to `main` — the `Build & Deploy` workflow does the rest.

2. **Sanity check** after first deploy:
   - Open `https://<your-username>.github.io/hibiki/`
   - Confirm the album grid renders with real data.
   - Click a track row — audio should start (or 404 if LFS isn't downloaded).

## Audio CDN: Cloudflare R2 (recommended)

Git LFS has a **10 GB free storage quota**. For a growing music archive the
right solution is to host audio on Cloudflare R2, which has:
- 10 GB free storage
- **Zero egress fees** (Cloudflare's explicit product commitment)
- S3-compatible API — no proprietary client needed
- Global CDN via Cloudflare's network

### One-time R2 setup

1. Create a [Cloudflare account](https://cloudflare.com) (free).
2. Go to **R2** → **Create bucket** (name it e.g. `hibiki-music`).
3. Under **Settings → Public access**, enable the public R2.dev subdomain
   *or* connect a custom domain.
4. Go to **R2 → Manage R2 API Tokens** → **Create API Token**:
   - Permissions: Object Read & Write on the bucket.
   - Save the Account ID, Access Key ID, Secret Access Key.
5. Add five **GitHub repository secrets** (Settings → Secrets → Actions):

   | Secret | Value |
   |--------|-------|
   | `R2_ACCOUNT_ID` | Your Cloudflare account ID |
   | `R2_BUCKET` | Bucket name (`hibiki-music`) |
   | `R2_ACCESS_KEY_ID` | R2 API token access key |
   | `R2_SECRET_ACCESS_KEY` | R2 API token secret key |
   | `R2_PUBLIC_URL` | Public hostname (e.g. `pub-xxxx.r2.dev` or `cdn.yourdomain.com`) |

6. Set CORS on the bucket (R2 → bucket → Settings → CORS):
   ```json
   [
     {
       "AllowedOrigins": ["https://<your-github-pages-domain>"],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedHeaders": ["Range"],
       "ExposeHeaders": ["Content-Length", "Content-Range"],
       "MaxAgeSeconds": 86400
     }
   ]
   ```

### Migrate existing audio to R2

```bash
# Step 1 — extract metadata into tracks.yaml (run locally while audio is on disk)
pip install mutagen PyYAML
python scripts/extract_metadata.py
git add music/**/*.yaml
git commit -m "feat: tracks.yaml for LFS-free CI"
git push

# Step 2 — upload audio (incremental; skips unchanged files by size)
pip install boto3
python scripts/sync_r2.py \
  --account-id  YOUR_CF_ACCOUNT_ID \
  --bucket      hibiki-music \
  --access-key  R2_ACCESS_KEY \
  --secret-key  R2_SECRET_KEY

# Step 3 — (optional) clean LFS history to free quota
pip install git-filter-repo
git filter-repo \
  --path-glob '*.mp3' --path-glob '*.m4a' \
  --path-glob '*.flac' --path-glob '*.aac' \
  --invert-paths
git push --force-with-lease
# Then open a GitHub support ticket to GC orphaned LFS objects.
```

After the secrets are set, every `git push` to `main` automatically:
1. Skips the multi-GB LFS download (`lfs: false`).
2. Syncs only new audio files to R2 (incremental, fast).
3. Builds `catalogue.json` from `tracks.yaml` (no audio files needed).
4. Deploys to GitHub Pages in minutes.

## Quotas reference

| Resource | Free limit | Notes |
|----------|-----------|-------|
| GitHub Pages size | 1 GB per deployment | Audio excluded — only shell + catalogue |
| GitHub Pages bandwidth | 100 GB/month | For static JS/CSS/JSON only |
| GitHub LFS storage | 10 GB | Shared across all LFS-tracked files |
| GitHub LFS bandwidth | 10 GB/month | Each CI checkout pulls all LFS files |
| Cloudflare R2 storage | 10 GB | Then $0.015/GB/month |
| Cloudflare R2 egress | **Free** | No bandwidth charges via Cloudflare CDN |
| GitHub Actions | 2,000 min/month (public repos: unlimited) | Build ~1–2 min per push |

## Custom domain

1. Add a `CNAME` file to `public/` containing your domain.
2. Point DNS: `CNAME your.domain → <username>.github.io`
3. Enable **Enforce HTTPS** in GitHub Pages settings.
4. Update the CORS `AllowedOrigins` in your R2 bucket to match.

## Build script reference

```
python scripts/build_catalogue.py [OPTIONS]

  --zips            Build sharded iPod-structure ZIPs into _zips/
  --cdn-base URL    Embed URL as meta.media_base_url in catalogue.json
  --thumb-size N    Thumbnail dimension in px (default: 96)
  --thumb-quality Q JPEG quality 1–95 (default: 65)
```

## Rolling back a bad push

```bash
git revert <bad-sha>
git push
```

The catalogue regenerates from the current `music/` tree on every deploy.
Audio files in R2 are immutable objects — they are never deleted by the
sync script unless `--delete` is passed explicitly.

## Adding music after initial setup

1. Place audio in `music/<Artist>/<Album>/` (any nesting depth works).
2. Add `meta.yaml` with `year` and `genre`.
3. Add `cover.jpg` (square, ≥ 600 px) if available.
4. Commit and push — CI handles the rest.

For new audio when R2 is configured, the CI sync step uploads only the new
files on the next push. No manual R2 action required.
