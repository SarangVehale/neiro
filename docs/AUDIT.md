# NEIRO 音色 — Audit

_Last reviewed: 2026-05-30 against commit `df4bdbb`+._

A snapshot of the current state across security, compliance, dependencies,
system, disaster-recovery and continuity dimensions. Items are scored as:

- **✅ in place** — observed, tested, working.
- **🟡 partial** — works but with known gaps or caveats.
- **❌ missing** — not implemented yet; tracked here so it surfaces in
  reviews.

---

## 1. Feature audit

Verified end-to-end via Playwright against the live deployment.

| Area | Status | Evidence |
|---|---|---|
| Library grid + filters + search + sort | ✅ | Last QA session: 45 cards, filter "flac"=1, search "benjamin"=4. |
| Album page + tracklist + downloads | ✅ | Track download saves a 12 MB `.m4a` with progress toast; shard download saves zip. |
| Player bar play/pause/next/prev | ✅ | `pbTitle` advances after `#pbNext`. |
| Shuffle + repeat (off/all/one) | ✅ | `pbShuffle.active`, `pbRepeat.repeat-one` confirmed. |
| Full-screen player (open / swipe to close) | ✅ | `#fullPlayer.open` toggles, swipe-down dispatch closes. |
| Routing (hash deep links + browser back) | ✅ | `#/library/album/:id` populates on click, popstate replays. |
| Add to queue / play next | ✅ | Queue panel in sidebar reflects new items; play-next inserts at idx+1. |
| Surprise me | ✅ | Navigates to a random album. |
| Continue listening | ✅ | localStorage `neiro-resume` restored at boot with seek to saved position. |
| Share link (album / full player) | ✅ | `navigator.clipboard` copies `#/library/album/:id`. |
| Theme toggle (light default) | ✅ | localStorage `neiro-theme` persists. |
| Mobile filter sheet | ✅ | Bottom sheet opens / dismisses, filters re-render. |
| Media Session API | ✅ | `navigator.mediaSession.metadata` populated; actions bound. |
| Persistent player across nav | ✅ | Title + play state unchanged after route change. |
| Contribute → GitHub issue | ✅ | Submit opens `issues/new?template=…` with prefilled fields. |
| Service worker offline fallback | 🟡 | Shell pre-cached; navigations network-first w/ shell fallback. Catalogue stale-while-revalidate. Audio never cached (intentional). |
| Lyrics | ❌ | Not in catalogue today. |
| Crossfade / gapless playback | ❌ | Single audio element, no overlap. |
| Multi-album persistent queue UI on phone | 🟡 | Queue is built per-album; cross-album queue is internal-only — no UI to inspect/reorder on mobile. |

---

## 2. Security audit

### 2.1 Content Security Policy

The meta CSP (live as of `df4bdbb`+) is:

```
default-src 'self';
script-src  'self' 'unsafe-inline';
style-src   'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src    'self' https://fonts.gstatic.com data:;
img-src     'self' data: https:;
media-src   'self' https: blob:;
connect-src 'self' https://media.githubusercontent.com
                   https://raw.githubusercontent.com;
worker-src  'self';
```

- ✅ `default-src 'self'` denies anything not explicitly allowed.
- 🟡 `script-src 'unsafe-inline'` is required because boot logic in
  `index.html` registers the SW inline. Could be tightened to a nonce.
- ✅ `connect-src` is tight — only GH media (audio + zip downloads) is
  allowed. jsdelivr was removed when icons moved on-host (P1).
- ✅ `img-src https:` is permissive enough for any future CDN-hosted
  cover; constrained by `data:` for the inline kanji art. Not a
  meaningful XSS surface for an image src.
- ❌ `frame-ancestors` cannot be set via meta CSP (HTTP-only); add it
  via GitHub Pages headers if/when configurable.

### 2.2 XSS surface

- ✅ Every string from `catalogue.json` flows through `esc()` before
  hitting `innerHTML` (artist names, titles, notes, genre, kana). Spot
  check: `cardHTML`, `viewAlbum`, `viewArtist`, `viewContributors` all
  pass user-controlled strings through `esc()`.
- ✅ Toast text now also goes through `esc()` (fixed in same session).
- 🟡 The download blob filename is template-interpolated into an `<a
  download>` value — but `download` is treated as a hint, not HTML, so
  no XSS. Worth noting only because a future change might use the value
  in `innerHTML`.
- ✅ `dangerouslySetInnerHTML`-style API patterns aren't used — there's
  no React.

### 2.3 Supply chain

- **Runtime JS deps:** zero. The only third-party code shipped is
  Tabler-icons SVGs (MIT) baked into `tabler.css` and Google Fonts
  served from `fonts.gstatic.com`. No `package.json`, no npm install,
  no transitive dependency graph.
- **Build deps (Python):** `mutagen` (LGPL-2.1), `Pillow` (HPND-style),
  `PyYAML` (MIT). All from PyPI, all widely used.
- **CI deps:** `actions/checkout@v4`, `actions/upload-pages-artifact@v5`,
  `actions/deploy-pages@v5`, `actions/setup-python@v5`. All pinned to
  major versions.
- 🟡 No automated dependency scanning yet — Dependabot is enabled
  (per `.github/dependabot.yml`), which is sufficient for this scale.

### 2.4 Secrets

- ✅ `R2_ACCOUNT_ID` and `R2_PUBLIC_URL` are GitHub Actions secrets,
  not in the repo. Falls back to `media.githubusercontent.com` when
  absent.
- ✅ No API keys are needed at runtime — the site is fully static.
- ✅ No analytics or telemetry beacons. No third-party JS at runtime.

### 2.5 Authentication / authorization

- ✅ N/A. No user accounts, no sessions, no cookies. localStorage
  holds only `neiro-theme` and `neiro-resume`, both per-device, no
  identifiers.

---

## 3. Compliance audit

### 3.1 Accessibility (WCAG 2.1 AA target)

| Criterion | Status | Notes |
|---|---|---|
| Semantic landmarks (`<nav>`, `<main>`, `<aside>`) | ✅ | Used. |
| Keyboard navigation through cards / rows | 🟡 | Tab works; arrow-key navigation through the grid not implemented. |
| Visible focus styles | 🟡 | `:focus-visible { outline: 2px solid sakura }` on cards; default elsewhere. Should be tightened. |
| Form labels associated with inputs | ✅ | `for=`/`id=` pairs throughout the Contribute form. |
| Colour contrast | 🟡 | Ink-on-cream meets AA; `--ink-faint` on `--cream` likely fails for body text — only used for tiny metadata. Worth a Contrast Checker pass. |
| Reduced motion respected | ✅ | `prefers-reduced-motion: reduce` disables skeleton shimmer and route fade. |
| Screen-reader-only labels | ✅ | `.sr-only` used for icon-only buttons; ARIA labels on player controls and search field. |
| Live regions for toasts | ✅ | `#toastRegion[aria-live="polite"]`. |

### 3.2 Licensing transparency

- ✅ Site code: MIT (`LICENSE`).
- ✅ Per-album licence in `meta.yaml`; surfaced in the album page via
  `notes` field. Worth a dedicated badge in a future pass.
- ✅ `CONTRIBUTING.md` requires a "Rights statement" on every
  submission via the GitHub issue template.

### 3.3 Privacy

- ✅ No cookies, no third-party trackers, no analytics.
- ✅ `localStorage` use is local-only; no transmission.
- ✅ Fetched resources: app shell (same-origin) + audio (GH CDN) +
  fonts (Google Fonts) + cover thumbs (same-origin). Only Google Fonts
  sees the user's IP — a known concession of using their CDN.

---

## 4. System & application audit

### 4.1 Deploy pipeline

- ✅ Single workflow (`.github/workflows/build.yml`) does
  catalogue→CDN injection → sitemap generation → Pages upload → deploy.
  Concurrency-grouped under `pages`. Permissions are scoped correctly.
- ✅ Tests workflow (`.github/workflows/test.yml`) runs on every push.
- ✅ PR validation workflow (`.github/workflows/validate-pr.yml`) gates
  contributions.
- 🟡 No staging environment — main is production. Acceptable at this
  scale but worth flagging.

### 4.2 Error handling

- ✅ `loadCatalogue()` falls back to an empty catalogue on fetch error
  and emits a warning to console.
- ✅ Download failures show a "Download failed — <msg>" toast.
- ✅ Audio `play()` failures are swallowed silently to avoid noisy
  promise rejections on browsers that block autoplay. Pause/play state
  still updates from `audio.addEventListener('play'|'pause')`.
- 🟡 `catalogue.json` parse failure doesn't show a user-facing error;
  the empty fallback renders an empty grid. Worth a friendly banner.

### 4.3 Code health

- Single IIFE in `hibiki.js` (~1300 lines). Linear, well-commented.
  Functions are short and focused. No dependency on a framework.
- CSS is a single file with documented section headers.
- Inputs are sanitized at the boundary (`esc()`); state is centrally
  held in `state.player` and `state.filters`.

---

## 5. Disaster recovery

### 5.1 Risk register

| Asset | Failure mode | Blast radius | Recovery |
|---|---|---|---|
| GitHub Pages | Outage | Whole site down | Wait. Pages is highly available. No SLA but historically multi-9. Could mirror to Cloudflare Pages in <1 hour. |
| `media.githubusercontent.com` / R2 | Audio fetch fails | Playback + download broken; UI still loads | SW serves cached shell; user sees error toast on download. Mitigation: alternate CDN behind a feature flag. |
| Google Fonts | Slow / down | Text rendered in fallback (`serif` / `monospace` / `sans-serif`) | `font-display: swap` already mitigates. |
| The catalogue.json | Corrupted | Empty library, no albums | Fall back already returns `{ artists: [] }`. Build script is deterministic — re-run reproduces the same JSON. |
| Service worker | Bad release pinned | Stuck on stale shell | `VERSION` bump in `sw.js` forces re-fetch. Documented in `docs/DEPLOY.md`. |
| LFS bandwidth quota | Exhausted (it has been) | Audio 429s | Switch `MEDIA_BASE` to R2 secrets via workflow. Already wired. |

### 5.2 Backups

- ✅ Source: full git history, distributed by clone.
- 🟡 Audio masters: live in LFS today; user has noted storage migration
  to R2 is planned next session. Audio originals beyond LFS should be
  backed up off-platform.
- ✅ Catalogue: regenerated deterministically from on-disk audio. No
  irreplaceable data in `catalogue.json`.

### 5.3 Restore drill

A "from-scratch on a new host" restore needs only:
1. `git clone https://github.com/SarangVehale/hibiki`
2. `cd hibiki && python3 -m http.server 8000` for local dev, _or_
3. Re-enable GitHub Pages on a new fork to redeploy.

There's no database, no environment migration, no schema. Recovery
time is bounded by `git clone` time.

---

## 6. Business continuity

### 6.1 Single-maintainer risk

The repository today has one primary maintainer (per `contributors.yaml`).
That's a fork-bus-factor of 1.

**Mitigations in place:**
- ✅ Repo is public. Anyone can fork and continue.
- ✅ The site code is MIT — no licence friction for a fork.
- ✅ The contribution flow is documented (`CONTRIBUTING.md`).
- ✅ The build pipeline is reproducible end-to-end from `requirements.txt`.

**Mitigations missing:**
- ❌ No co-maintainer formally listed.
- ❌ No documented hand-off procedure (where keys live, how R2 is
  configured, who can publish to Pages).
- ❌ No archived snapshot at e.g. archive.org so the catalogue
  survives a repo deletion. (Recommended: cron a monthly
  archive.org/Wayback save.)

### 6.2 Knowledge transfer

- ✅ `docs/ARCHITECTURE.md` exists.
- ✅ `docs/DEPLOY.md` exists.
- ✅ `docs/AUDIT.md` (this file) covers the current state.
- 🟡 An `OPERATIONS.md` covering rollback, SW cache busts, R2 secret
  rotation, and "what to do when LFS quota hits" would close the gap.

### 6.3 Cost & funding continuity

- ✅ Free as long as GitHub Pages + GitHub Actions free tier hold
  (public repo).
- ✅ R2 zero-egress free tier easily covers archive-scale traffic at
  current volume.
- 🟡 If the project grows past free tiers, there's no funding pipeline
  documented. Sponsors / GitHub Sponsors button could be added.

---

## 7. Action items

Sorted by impact / effort.

1. Add `frame-ancestors` via HTTP headers (when GH Pages exposes them).
2. Replace `'unsafe-inline'` in `script-src` with a per-deploy nonce.
3. Add arrow-key navigation through `.album-grid`.
4. Audit colour contrast on `--ink-faint` text.
5. Add `OPERATIONS.md` covering rollback / SW cache busts / secrets.
6. Wire up a monthly archive.org snapshot.
7. List a co-maintainer; document the hand-off.
8. Consider Cloudflare Pages mirror for outage redundancy.
9. Add a friendly "catalogue failed to load" banner.
10. Add a sponsors / funding link (`FUNDING.yml`).

None of these is a blocker for the current public launch. They are the
hardening backlog.
