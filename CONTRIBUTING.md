# Contributing to HIBIKI

Thank you for adding to the archive. The whole project is structured so
that "adding music" is the same gesture as any other open-source PR.

## Adding an album

1. **Confirm you have the right to share it.** HIBIKI only accepts
   material the contributor owns or that is unambiguously in the public
   domain. If you're not the rights-holder, get written permission first
   and attach it to the PR.

2. **Fork and clone.**
   ```bash
   git clone git@github.com:SarangVehale/hibiki.git
   cd hibiki
   git lfs install
   ```

3. **Add files under `music/<Artist>/<Album>/`.**

   ```
   music/Kaoru Tanaka/River Without Banks/
   ├── 01 - Mist Inventory.flac        # NN - Title.ext
   ├── 02 - First Light, Held.flac
   ├── 03 - Stone Counting Stones.flac
   ├── cover.jpg                       # square, ≥ 600 px
   └── meta.yaml
   ```

   Track filenames must be `NN - Title.ext`. Supported extensions:
   `.flac` `.mp3` `.m4a` `.aac`. The builder reads ID3/Vorbis tags via
   `mutagen` and falls back to the filename if tags are missing.

4. **Write `meta.yaml`** (one per album):
   ```yaml
   title: River Without Banks
   year:  2019
   genre: Ambient
   notes: Recorded over four winter mornings in Higashiyama.
   license: CC-BY-4.0
   source: "Donated by the artist, Jan 2026."
   ```

5. **(First-time artist) add `music/<Artist>/artist.yaml` and `bio.md`.**
   ```yaml
   # artist.yaml
   kana: TANAKA · KAORU
   origin: Kyoto, JP
   genre: Ambient
   links:
     - { label: Bandcamp, url: "https://..." }
   ```
   ```markdown
   <!-- bio.md — one or two paragraphs -->
   Kaoru Tanaka has spent twenty-three years recording above the Kamo river…
   ```

6. **Add yourself to `contributors.yaml`** (or increment your entry).

7. **Open a PR.** CI validates size, formats, and cover art, posting a
   summary comment. Fix any errors it flags, then the maintainer merges.

After merge the build job regenerates the catalogue and re-deploys within
a couple of minutes.

## Editing the site itself

- Styles: `public/hibiki.css` — design tokens at the top.
- App logic: `public/hibiki.js` — boots after `hibiki-data.js` resolves.
- Catalogue loader: `public/hibiki-data.js` — fetches and adapts the JSON.
- Builder: `scripts/build_catalogue.py`. Tests in `tests/`; run
  `pytest tests/` before opening a PR.

## Commit style

Conventional-Commits prefix, lowercase, ≤72 chars:

```
add: kaoru tanaka — river without banks (2019)
fix: format filter case mismatch with catalogue output
docs: clarify shard boundary algorithm
ci: bump actions/checkout to v4
```

Audio submissions should be separate commits from code or metadata changes.

## What we won't accept

- Material the contributor does not have the right to share.
- Re-uploads of commercially available releases without permission.
- Promo packages or anything tied to a sales funnel.
- Heavily compressed MP3 when a lossless source exists.

## Code of conduct

By contributing you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
