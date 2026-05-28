# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/SarangVehale/hibiki/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/SarangVehale/hibiki/releases/tag/v0.1.0
