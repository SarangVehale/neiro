# Architecture

## One-line version

`music/` is the source of truth → a Python script generates `catalogue.json`
and album ZIPs → a static front-end fetches the JSON and renders it →
GitHub Pages serves everything.

## Two pipelines, one repo

### Build pipeline (CI, on push to `main`)

1. `actions/checkout@v4` with `lfs: true`.
2. `pip install mutagen Pillow PyYAML` (all optional — builder degrades gracefully).
3. `python scripts/build_catalogue.py --zips`:
   - walks every `music/<Artist>/<Album>/`
   - reads tags via `mutagen`, falls back to filename pattern `NN - Title.ext`
   - shards albums > 150 MB into ≤ 130 MB ZIPs on track boundaries
   - embeds a 320×320 JPEG base64 cover thumbnail per album
   - writes `_catalogue/catalogue.json`
4. Assembles `public/` with `_catalogue/`, `_zips/`, and `music/` (so `track.path` resolves).
5. Deploys via `actions/upload-pages-artifact` + `actions/deploy-pages`.

### Validation pipeline (on every music PR)

`.github/workflows/validate-pr.yml` checks size limits, format sanity, and
cover presence, posting a sticky comment with the results. Merge only happens
after the maintainer reviews.

### Test pipeline (on every PR touching code)

`.github/workflows/test.yml` runs `pytest tests/ -v`.

## Front-end boot order

```
hibiki-data.js   →   fetch _catalogue/catalogue.json → adapt → window.CATALOGUE
hibiki.js        →   await window.HIBIKI_CATALOGUE_PROMISE → render
sw.js            →   registered by inline <script> in index.html
```

Catalogue is fetched at runtime so adding an album only requires regenerating
the JSON — no JavaScript rebuild needed.

## Catalogue JSON shape

```jsonc
{
  "meta": {
    "total_songs": 3,
    "total_artists": 1,
    "built_at": "2026-05-28T10:00:00+00:00",
    "contributors": [{ "handle": "@…", "albums": 1, "songs": 3, "first": "…", "latest": "…" }]
  },
  "artists": [
    {
      "id": "kaoru-tanaka",
      "name": "Kaoru Tanaka",
      "kana": "TANAKA · KAORU",
      "origin": "Kyoto, JP",
      "genre": "Ambient",
      "bio": "…",
      "links": [{ "label": "Bandcamp", "url": "…" }],
      "albums": [
        {
          "id": "kaoru-tanaka-river-without-banks",
          "title": "River Without Banks",
          "year": 2019,
          "genre": "Ambient",
          "notes": "…",
          "cover": "data:image/jpeg;base64,…",
          "total_size_mb": 314.0,
          "shards": [
            { "label": "Part 1 of 3", "path": "_zips/…", "size_mb": 128.0 }
          ],
          "tracks": [
            { "number": 1, "title": "Mist Inventory", "duration_sec": 412,
              "format": "FLAC", "size_mb": 38.7,
              "path": "music/Kaoru Tanaka/River Without Banks/01 - Mist Inventory.flac" }
          ]
        }
      ]
    }
  ]
}
```

The adapter (`hibiki-data.js`) adds: `album.artist`, `album.artistId`,
`album.kanjiIdx`, `album.totalSize`, `album.totalDuration`, `album.fmt`
(lowercase), `CATALOGUE.allAlbums`, `CATALOGUE.totalSongs`.

## Why static, why vanilla?

- **Static** — no per-user state. A backend would just be an attack surface.
- **Vanilla** — the front-end is ~3 kLOC. A framework adds more than it saves.
- **PWA** — works offline once visited; installable on phones. Audio not cached.

## Scaling past GitHub Pages

When `music/` + `_zips/` exceed ~800 MB, move heavy files to object storage
(Cloudflare R2 recommended — free egress). Keep `catalogue.json` and the site
on Pages; add a `media_base_url` to `meta` and prefix `track.path` in the
adapter. See [DEPLOY.md](DEPLOY.md).
