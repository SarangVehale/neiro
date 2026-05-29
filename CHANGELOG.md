# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] — 2026-05-29

### Added

**Full-screen player**
- Clicking the player-bar art or track-title area slides up a full-screen player
  overlay (CSS `translateY` transition, z-index 400).
- Shows full-size album art (CDN URL, base64 fallback, kanji placeholder),
  track title, album, artist, seekable progress bar, and prev/play/next controls.
- All controls stay in sync with the bottom player bar via `syncFullPlayer()`
  called from `updateBar()`, `updateProgress()`, and `updatePlayState()`.
- Close with the chevron-down button or by tapping outside the overlay area.

**Responsive layout — full breakpoint ladder**
- Hamburger menu (`#navToggle`) replaces nav links at ≤ 768 px. The `.mobile-nav`
  drawer uses opacity + translateY instead of display-toggling so `flex-direction: column`
  is always set and the slide-in animation is reliable.
- New breakpoints: 1920 px (scale up font/columns), 1280 px, 1024 px, 768 px,
  640 px, 480 px, 375 px (iPhone 13 mini).
- Player bar strips art/volume/format badge at ≤ 768 px; further compacts at ≤ 640 px.
- Tracklist hides Format / Size / Download columns at ≤ 640 px.
- Hero strip hidden at ≤ 480 px to recover screen real-estate.
- Logo wordmark hidden at ≤ 480 px; only the 響 kanji remains.

**Album art in all slots**
- Album cards now render `<img src="album.cover">` (base64 96 px thumbnail) when
  available, with a kanji fallback.
- Album detail hero uses the full-size CDN image (`album.coverUrl`) with base64
  fallback.
- Now-playing sidebar and player bar art slot both updated.
- `onerror` handler on every `<img>` hides broken images gracefully.

**`cover_path` field in catalogue**
- `build_catalogue.py` now exposes `find_cover_file()` and records the
  repo-relative cover image path as `cover_path` on each album entry.
- `hibiki-data.js` constructs `album.coverUrl` at load time from
  `mediaBase + encoded(cover_path)`.
- SVG covers are recorded in `cover_path` but produce no base64 thumbnail.

**Playwright live smoke tests** (`tests/playwright/tests/live.spec.js`)
- Eight tests run against the deployed GitHub Pages site on every push to `main`:
  page title, catalogue load count, album card render, `media_base_url` present,
  all nav routes (no JS errors), album detail tracklist, audio title update, no
  console errors.

**Service worker v2 — cache-busting and catalogue exclusion**
- `VERSION` bumped `"hibiki-v1"` → `"hibiki-v2"` so users stuck on the old cache
  get fresh assets on next visit.
- `_catalogue/` added to the never-cache list alongside audio; catalogue is always
  fetched from the network.

### Fixed

**Playback — LFS files not served by `raw.githubusercontent.com`**
- Changed fallback CDN from `https://raw.githubusercontent.com/…` to
  `https://media.githubusercontent.com/media/…`. The `raw` endpoint returns
  the LFS pointer file (plain text); `media` serves the actual binary.

**URL encoding — 474 track paths and 20 cover paths with spaces**
- `hibiki-data.js` now encodes each path segment with `encodeURIComponent` before
  constructing the full CDN URL for both audio (`t.path`) and images (`coverUrl`).
- `loadTrack()` no longer applies `encodeURI()` on top (would double-encode `%`).

**Corrupt cover thumbnails — LFS pointer stubs**
- `cover_thumb()` now rejects files shorter than 128 bytes (LFS pointer stubs)
  and files PIL cannot open. Eliminated one 55-byte phantom entry (Kaoru Tanaka).

**NaN decade filter**
- `DECADES` sidebar list now filters out `NaN` values produced by albums with
  `year: null` (`Math.floor(null/10)*10 === NaN`).
- Decade filter predicate guards with `!a.year` to prevent albums without years
  from disappearing when any decade is selected.

### Changed

- Album grid: `minmax(200 px, 1fr)` → `minmax(140 px, 1fr)`, gap 14 px → 8 px.
  Typical card width drops from ~200 px to ~161 px; more albums visible at once.
- Card body padding and font sizes reduced proportionally (title 13 px → 11 px,
  artist 11 px → 10 px, meta 9 px → 8 px).
- Art-wrap kanji font: `clamp(34 px, 4 vw, 52 px)` → `clamp(24 px, 3 vw, 40 px)`.
- CI build: inject step now injects `media.githubusercontent.com` CDN URL in the
  R2-absent fallback (was `raw.githubusercontent.com`).
- Local verification suite added: `tests/playwright/tests/local-verify.spec.js`
  (11 tests against `localhost:18080`).

---

## [0.2.0] — 2026-05-29

### Added

**Storage — Cloudflare R2 migration path**
- `build.yml` now has a dual mode: when `R2_ACCOUNT_ID` secret is set the
  workflow syncs audio to Cloudflare R2 via `aws s3 sync` and skips the
  multi-GB LFS checkout entirely; without the secret it falls back to the
  original LFS + GitHub raw CDN path.
- New `--cdn-base URL` flag on `build_catalogue.py` — the CDN base URL is now
  embedded directly by the Python script rather than via a fragile inline
  Python snippet in the workflow YAML.
- `scripts/sync_r2.py` — Cloudflare R2 upload tool. Incremental (size-based
  skip), audio-only (excludes YAML/cover/markdown), sets immutable
  `Cache-Control` headers. Run once to migrate; CI handles new additions.
- `scripts/extract_metadata.py` — pre-migration tool that reads every audio
  file with mutagen and writes a `tracks.yaml` beside each album. Once
  committed, CI can build the full catalogue without downloading LFS objects.

**Build script — metadata-only mode**
- `build_catalogue.py` now reads `tracks.yaml` if it exists beside an album
  and skips audio file scanning entirely, enabling no-LFS CI builds.
- Parent-directory `artist.yaml` files are now merged for nested structures
  (`music/Artist/Sub-artist/Album/`). A `Sub-artist/artist.yaml` with
  `genre: Lo-Fi` automatically propagates to all albums under it.

**Build script — new CLI flags**
- `--thumb-size N` — thumbnail dimension in px (default: 96, was hardcoded 320).
- `--thumb-quality Q` — JPEG quality (default: 65, was hardcoded 78).
- `--cdn-base URL` — base URL written into `meta.media_base_url`.

**CI — pip dependency caching**
- Added `actions/cache@v4` for `~/.cache/pip`. Saves 30–60 s per build after
  the first warm run.

### Fixed

**Critical: 91 songs silently dropped in nested directory structures**
- Albums more than one level deep under an artist directory (e.g.
  `music/Lofi/Tokyo chill lab/First Instar Melody (Side-A)/`) were silently
  skipped. The build script now uses fully recursive album discovery — any
  directory that directly contains audio files at any depth is treated as an
  album. Recovered 91 previously invisible tracks; total catalogue count
  increased from 405 to 496 songs.

**Genre metadata never read from audio tags**
- `read_tags()` only extracted title, track number, and duration. It now also
  reads the `genre` tag (ID3 `TCON` / MP4 `©gen`). Genre priority:
  album `meta.yaml` → inherited sub-artist `artist.yaml` → top-level
  `artist.yaml` → dominant tag genre across tracks → `"Unknown"`.

**Album ID collisions in nested structures**
- Slug generation now uses the full relative path from the artist directory
  rather than just the leaf name, preventing collisions when multiple
  sub-artists have albums with the same name.

**Cover art lookup missed intermediate directories**
- `cover_thumb()` now walks all parent directories from `album_dir` up to
  `artist_dir`, so a cover placed in a sub-artist folder is found for all
  albums under it.

**ZIP filenames with illegal filesystem characters**
- Sanitised album names used in ZIP paths by stripping `<>:"/\|?*`.

### Changed

- Thumbnail: **320×320 JPEG @78%** → **96×96 JPEG @65% + optimize=True**.
  `catalogue.json` shrank from ~9.3 MB to **243 KB** (97.4% reduction).
  Average per-cover footprint: 383 KB → 2.4 KB.
- `build_catalogue.py` now uses `argparse` instead of `"--zips" in sys.argv`.
- `process_artist` and `process_album` extracted as named functions.
- `build.yml` "Assemble static site" step no longer contains an inline Python
  snippet; `--cdn-base` flag handles it cleanly.
- About page tech table updated: "Git LFS" → "Cloudflare R2".
- `docs/ARCHITECTURE.md` and `docs/DEPLOY.md` updated for new storage model.

---

## [0.1.0] — 2026-05-28

First public release. The full pipeline works end-to-end: drop a folder
into `music/`, push, CI generates a catalogue, deploys to GitHub Pages.

### Added
- Vanilla HTML/CSS/JS single-page front-end (`public/`) with seven views:
  library, artist list, artist detail, album detail, contribute,
  contributors, about — and a sticky bottom player bar.
- PWA: `manifest.json` + service worker (`sw.js`). Offline shell cache;
  audio is never cached (too large).
- Python catalogue builder (`scripts/build_catalogue.py`) that walks
  `music/`, reads tags via `mutagen` (optional), embeds cover-art
  thumbnails via `Pillow` (optional), honours `meta.yaml` and
  `artist.yaml` overrides, and pre-builds sharded iPod-structure ZIPs.
- Real audio playback wired through `track.path` from the catalogue.
- GitHub Actions: `build.yml` (catalogue → Pages deploy), `test.yml`
  (pytest on every PR), and `validate-pr.yml` (size/format/cover checks
  with a sticky PR comment).
- Git LFS configuration for audio, cover art, and pre-built ZIPs.
- Project documentation: README, CONTRIBUTING, LICENSING, ARCHITECTURE,
  DEPLOY, CODE_OF_CONDUCT, SECURITY, CHANGELOG.
- GitHub issue/PR templates, Dependabot config.
- 12 unit tests for the catalogue builder.
- One seed album: Kaoru Tanaka — *River Without Banks* (3 tracks, FLAC).

### Design
- Aesthetic: "1987 Japanese music magazine meets retro Apple hardware."
- Palette: cream/ink with sakura accent, no gradients, no shadows.
- Typefaces: Shippori Mincho (editorial) + DM Mono (data) + Zen Kaku Gothic New (body).
- Kanji placeholders for missing album art, assigned by `albumIndex % 6`.

[Unreleased]: https://github.com/SarangVehale/hibiki/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/SarangVehale/hibiki/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/SarangVehale/hibiki/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/SarangVehale/hibiki/releases/tag/v0.1.0
