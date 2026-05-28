# Deploying HIBIKI

## First-time setup

1. **Enable Git LFS** on the repo (Settings → "Git Large File Storage").
   Free tier: 1 GB storage + 1 GB/month bandwidth.

2. **Enable GitHub Pages** (Settings → Pages):
   - Source: **GitHub Actions** (not "Deploy from a branch").
   - Push to `main` — the `Build & Deploy` workflow does the rest.

3. **Sanity check** after first deploy:
   - Open `https://sarangvehale.github.io/hibiki/`
   - Confirm the album grid renders with real data.
   - Click an album → click a track → audio should request the FLAC.
   - If FLAC 404s, confirm `actions/checkout@v4` ran with `lfs: true`
     (the workflow already has it) and that LFS is enabled on the repo.

## Custom domain

Add a `CNAME` file to `public/` containing your domain, point DNS at
`sarangvehale.github.io`, enable "Enforce HTTPS" in Pages settings.

## Quotas

| Limit | Notes |
|---|---|
| Pages size: 1 GB | Total deployed artifact |
| Pages bandwidth: 100 GB/month | Downloads count against this |
| LFS storage: 1 GB free | Then $5/50 GB/month |
| LFS bandwidth: 1 GB/month free | Mostly CI checkouts |
| Actions minutes: 2000/month free | Build jobs are ~1 min each |

## Scaling past Pages

When `music/` + `_zips/` approach 800 MB:

1. Move audio + ZIPs to **Cloudflare R2** (free egress) or Backblaze B2.
2. Keep `catalogue.json` and the site on Pages.
3. In the build job, sync heavy assets to the bucket and inject
   `media_base_url` into `catalogue.json`:
   ```bash
   jq --arg base "$MEDIA_BASE_URL" '.meta.media_base_url = $base' \
      _catalogue/catalogue.json > tmp && mv tmp _catalogue/catalogue.json
   ```
4. In `public/hibiki-data.js` `adapt()`, prefix paths:
   ```js
   const base = raw.meta?.media_base_url ?? "";
   if (base) track.path = base + "/" + track.path;
   ```
5. Set CORS on the bucket: `Access-Control-Allow-Origin: https://sarangvehale.github.io`

## Rolling back

`git revert <bad sha>` + push. The catalogue regenerates from the
current `music/` tree on every deploy; audio files are immutable in LFS.
