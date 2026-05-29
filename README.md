# HIBIKI 響

A free, public music archive. Browse, preview, and download — no account, no
ads, no paywall. Donated material only.

![type: static site](https://img.shields.io/badge/type-static%20site-c9667a)
![hosting: github pages](https://img.shields.io/badge/hosting-github%20pages-2a2318)
![audio cdn: cloudflare r2](https://img.shields.io/badge/audio%20cdn-cloudflare%20r2-f38020)
![license (code): MIT](https://img.shields.io/badge/license%20%28code%29-MIT-7eb89a)
![content: see LICENSING.md](https://img.shields.io/badge/content-see%20LICENSING.md-d4a060)

## What this is

- **A single-page static site** — vanilla HTML/CSS/JS, no framework, no backend.
- **`music/` is the source of truth** — drop in an album folder, open a PR,
  and after merge it ships to the live site automatically.
- **A Python build script** (`scripts/build_catalogue.py`) walks `music/` at
  any directory depth, reads ID3/MP4 tags, generates `_catalogue/catalogue.json`,
  and pre-builds sharded iPod-structure ZIPs per album.
- **A GitHub Actions workflow** runs the build on every push to `main` and
  deploys to GitHub Pages. Audio is served from `media.githubusercontent.com`
  (LFS CDN), with Cloudflare R2 as the recommended upgrade for large collections.
- **Fully responsive** — scales from iPhone 13 mini (375 px) to projector screens,
  with a hamburger nav on mobile and a full-screen player overlay.

There is no backend, no database, no analytics, no tracking. It scales to
any number of concurrent users because every response is a static file from a CDN.

## Quickstart (local dev)

```bash
git clone git@github.com:SarangVehale/hibiki.git
cd hibiki

# Audio files are in Git LFS. Pull them only if you need local playback;
# the catalogue can be built from file metadata alone without downloading audio.
git lfs pull                          # optional — ~5.6 GB

pip install mutagen Pillow PyYAML     # optional but recommended for rich tags

python scripts/build_catalogue.py     # writes _catalogue/catalogue.json
                                      # 96×96 thumbnails, ~245 KB output

# Inject a CDN base URL for the local server (makes audio paths relative)
python scripts/inject_cdn.py http://localhost:8000/music

# Serve locally (file:// won't work — app fetches catalogue.json via XHR)
cd public
python3 -m http.server 8000
open http://localhost:8000
```

## Repository layout

```
.
├── public/                     # static web root deployed to GitHub Pages
│   ├── index.html              #   PWA shell — no framework, no build step
│   ├── hibiki.css              #   styles (1987 Japanese magazine × retro Mac)
│   ├── hibiki.js               #   full app logic (~830 LOC, vanilla JS)
│   ├── hibiki-data.js          #   catalogue loader, CDN URL adapter & path encoder
│   ├── manifest.json           #   PWA manifest
│   ├── sw.js                   #   service worker v2 (caches shell; never audio/catalogue)
│   └── icon.svg                #   app icon
├── music/                      # the archive — source of truth
│   └── <Artist>/
│       ├── artist.yaml         #   kana, origin, genre, links (optional)
│       ├── bio.md              #   artist bio in Markdown (optional)
│       ├── cover.jpg           #   artist-level fallback cover (optional)
│       └── <Album>/            #   or <Sub-artist>/<Album>/ — any depth works
│           ├── 01 - Title.m4a  #   audio files: FLAC, MP3, M4A, AAC
│           ├── cover.jpg       #   square, ≥600 px (optional)
│           └── meta.yaml       #   year, genre, notes, license (optional)
├── scripts/
│   ├── build_catalogue.py      # catalogue + ZIP builder (Python, zero hard deps)
│   ├── extract_metadata.py     # one-time migration: writes tracks.yaml per album
│   └── sync_r2.py              # upload music/ to Cloudflare R2 (boto3)
├── tests/
│   ├── test_build_catalogue.py # pytest suite for the catalogue builder (12 tests)
│   └── playwright/             # Playwright e2e tests
│       ├── tests/live.spec.js  #   8 smoke tests against deployed GitHub Pages
│       └── tests/local-verify.spec.js # 11 tests against localhost:18080
├── _catalogue/
│   └── catalogue.json          # generated artefact; committed for convenience
├── contributors.yaml           # one entry per contributor handle
└── .github/
    ├── workflows/
    │   ├── build.yml           #   CI: build catalogue → deploy Pages (R2-aware)
    │   ├── test.yml            #   CI: pytest on every PR
    │   └── validate-pr.yml     #   CI: size / format / cover checks on music PRs
    └── ISSUE_TEMPLATE/         # structured issue forms
```

## Adding music

See [CONTRIBUTING.md](CONTRIBUTING.md). In short:

1. Create `music/<Artist>/<Album>/` and drop in audio files.
   Sub-artist folders work too: `music/<Artist>/<Sub-artist>/<Album>/`.
2. Add `meta.yaml` with at minimum `year` and `genre`.
3. Add `cover.jpg` (square, ≥ 600 px) if you have one.
4. Open a PR — the validate workflow runs automatically.

### Supported structures

| Layout | Works? |
|--------|--------|
| `music/Artist/Album/track.flac` | Yes |
| `music/Artist/Sub-artist/Album/track.mp3` | Yes |
| `music/Artist/track.m4a` (loose, no album folder) | Yes — grouped as "Singles" |

### Setting genre

If your audio files don't embed a genre tag, add it in YAML:

```yaml
# music/Artist/artist.yaml
genre: Lo-Fi

# music/Artist/Album/meta.yaml
genre: Ambient
year: 2023
```

Genre priority: album `meta.yaml` → nearest `artist.yaml` ancestor → audio tag → "Unknown".

## Build script reference

```
python scripts/build_catalogue.py [OPTIONS]

  --zips            Also build sharded iPod-structure ZIPs into _zips/
  --cdn-base URL    Set meta.media_base_url in catalogue.json
  --thumb-size N    Cover thumbnail px (default 96)
  --thumb-quality Q JPEG quality 1-95 (default 65)
```

Runs with zero dependencies. Install `mutagen Pillow PyYAML` for tag reading,
thumbnail resizing, and YAML metadata support.

## Migrating audio to Cloudflare R2 (recommended for collections > 1 GB)

Storing large audio in Git LFS has a 10 GB quota. Cloudflare R2 has no
egress fees and 10 GB free storage — far better for a public streaming archive.

```bash
# 1. Extract metadata into tracks.yaml per album (one-time)
pip install mutagen PyYAML
python scripts/extract_metadata.py
git add music/**/*.yaml && git commit -m "feat: tracks.yaml metadata"
git push

# 2. Upload audio to R2 (incremental — skips unchanged files)
pip install boto3
python scripts/sync_r2.py \
  --account-id  YOUR_CF_ACCOUNT_ID \
  --bucket      hibiki-music \
  --access-key  R2_ACCESS_KEY \
  --secret-key  R2_SECRET_KEY

# 3. Add five secrets to GitHub → Settings → Secrets → Actions:
#    R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PUBLIC_URL

# After that, CI automatically:
# - skips the multi-GB LFS download
# - syncs only new audio to R2 on each push
# - builds the catalogue from tracks.yaml (fast, no audio files needed)
```

## Architecture & deploy

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — data flow, catalogue schema, boot order.
- [docs/DEPLOY.md](docs/DEPLOY.md) — GitHub Pages setup, R2 migration, scaling.

## Live site

**https://sarangvehale.github.io/hibiki/**

## Security

See [SECURITY.md](SECURITY.md) for vulnerability reporting and DMCA/takedown policy.

## License

- **Code** (site, scripts, CI): MIT — see [LICENSE](LICENSE).
- **Music & cover art** in `music/`: per-album, declared in `meta.yaml`.
  See [LICENSING.md](LICENSING.md).

## Project documents

| Document | Purpose |
|---|---|
| [CHANGELOG.md](CHANGELOG.md) | Full release history |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to add music or contribute code |
| [LICENSING.md](LICENSING.md) | Code vs content licence split |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | Community standards |
| [SECURITY.md](SECURITY.md) | Vulnerability reporting + takedown |
