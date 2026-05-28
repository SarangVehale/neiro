# HIBIKI 響

A free, public music archive. Browse, preview, and download — no account, no
ads, no paywall. Donated material only.

![type: static site](https://img.shields.io/badge/type-static%20site-c9667a)
![hosting: github pages](https://img.shields.io/badge/hosting-github%20pages-2a2318)
![license (code): MIT](https://img.shields.io/badge/license%20%28code%29-MIT-7eb89a)
![content: see LICENSING.md](https://img.shields.io/badge/content-see%20LICENSING.md-d4a060)

## What this is

- **A single-page static site** (vanilla HTML/CSS/JS, no framework).
- **A `music/` tree in this repo** is the source of truth — drop in an
  album folder, open a PR, and after merge it ships to the live site.
- **A Python script** (`scripts/build_catalogue.py`) walks `music/`, reads
  tags, generates `_catalogue/catalogue.json`, and pre-builds sharded ZIPs
  for each album so users can grab them in one click.
- **A GitHub Actions workflow** runs that script on every push to `main`
  and deploys the result to GitHub Pages.

There is no backend, no database, no analytics, no tracking.

## Quickstart

```bash
git clone git@github.com:SarangVehale/hibiki.git
cd hibiki
git lfs install                       # audio is tracked via Git LFS
pip install mutagen Pillow PyYAML     # optional but recommended
python scripts/build_catalogue.py     # writes _catalogue/catalogue.json

# serve locally (file:// won't work — app loads catalogue.json via fetch)
cd public
cp -r ../_catalogue ../music .
python3 -m http.server 8000
open http://localhost:8000
```

## Repository layout

```
.
├── public/                    # static web root that GitHub Pages serves
│   ├── index.html             #   vanilla shell + PWA wiring
│   ├── hibiki.css             #   styles (1987 Japanese magazine × retro Mac)
│   ├── hibiki.js              #   app logic
│   ├── hibiki-data.js         #   catalogue.json loader/adapter
│   ├── manifest.json          #   PWA manifest
│   └── sw.js                  #   service worker (offline shell, never caches audio)
├── music/                     # the archive itself — source of truth
│   └── <Artist>/
│       ├── artist.yaml        #   kana, origin, genre, links (optional)
│       ├── bio.md             #   artist bio (optional)
│       └── <Album>/
│           ├── 01 - Title.flac
│           ├── cover.jpg      #   square, ≥600px (optional)
│           └── meta.yaml      #   year, genre, notes, license (optional)
├── scripts/build_catalogue.py # the build step
├── tests/                     # pytest for the builder
├── _catalogue/catalogue.json  # generated; committed for convenience
├── contributors.yaml          # one entry per donator
└── .github/workflows/         # CI: test, validate-pr, build-and-deploy
```

## Adding music

See [CONTRIBUTING.md](CONTRIBUTING.md). Short version: put files in
`music/<Artist>/<Album>/`, optionally add `meta.yaml`/`bio.md`, open a PR.

## Architecture & deploy

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — data flow, schemas, boot order.
- [docs/DEPLOY.md](docs/DEPLOY.md) — GitHub Pages setup, LFS quotas, scaling.

## Live site

**https://sarangvehale.github.io/hibiki/**

## License

- **Code** (site, build script, CI): MIT — see [LICENSE](LICENSE).
- **Music & cover art** in `music/`: per-album, declared in each `meta.yaml`.
  See [LICENSING.md](LICENSING.md).

## Project documents

| | |
|---|---|
| [CHANGELOG.md](CHANGELOG.md) | Release history |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to add music or code |
| [LICENSING.md](LICENSING.md) | Code vs content licence split |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | Community standards |
| [SECURITY.md](SECURITY.md) | Vuln reporting + takedown |
