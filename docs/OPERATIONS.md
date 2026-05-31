# NEIRO 音色 — Operations runbook

Day-2 procedures for keeping the site running. For first-time setup, see
`DEPLOY.md`. For the architectural map, see `ARCHITECTURE.md`. For the
state-of-the-system snapshot, see `AUDIT.md`.

---

## Quick reference

| Incident | First action | Time to recover |
|---|---|---|
| Bad deploy live on Pages | `git revert HEAD && git push` | ~2 min (one workflow run) |
| Cached service worker serving stale shell | Bump `VERSION` in `public/sw.js` | ~2 min + per-client revisit |
| LFS bandwidth 429s on audio | Confirm R2 secrets are set; otherwise unset `R2_*` and accept fallback | Immediate (re-trigger workflow) |
| R2 outage / 5xx | Remove `R2_ACCOUNT_ID` secret → falls back to `media.githubusercontent.com` | ~2 min |
| Catalogue parse fails / shows banner | Roll forward with corrected `_catalogue/catalogue.json` | Single push |
| Pages outage | None available — Pages has no SLA. Mirror to Cloudflare Pages if needed. | Hours |

---

## Rolling back a bad deploy

The site is the `main` branch. There is no staging.

```bash
git revert <bad-sha>       # creates a new commit that undoes the bad one
git push origin main       # triggers Build & Deploy
```

Watch the workflow at `https://github.com/SarangVehale/neiro/actions`.
Once it completes, the rolled-back shell is live.

If the bad commit corrupted `_catalogue/catalogue.json`, the client falls
back to an empty grid + a "Catalogue failed to load" banner (see
`neiro-data.js`). The user can still navigate — playback is just empty.

> Do **not** force-push to `main`. The audit calls this out: there is no
> branch protection, but force-pushes will skip the Pages workflow and
> may leave Pages serving a stale artifact.

---

## Bumping the service worker

`public/sw.js` exports a `VERSION` constant. The SW deletes any cache whose
name doesn't match `VERSION` on activate (`sw.js:29`). To force every
client to refetch the shell:

```js
// public/sw.js
const VERSION = "neiro-v5";  // bump v4 → v5
```

Commit, push, and within the next user visit (or after the SW's own update
check, ~24 h max) the old cache is purged. There is no way to force a SW
refresh remotely — the user has to revisit the page.

Bump conditions:
- Any change to `index.html`, `neiro.js`, `neiro.css`, `neiro-data.js`,
  or `tabler.css` that's behavior-affecting.
- A CSP tightening (see Audit #2) — the old SW may have cached the looser
  CSP'd shell.

Do **not** bump for catalogue-only changes: `catalogue.json` is excluded
from the SW pre-cache and served stale-while-revalidate, so it updates on
the user's next visit without a SW bump.

---

## Rotating R2 secrets

R2 secrets live in **GitHub Settings → Secrets and variables → Actions**:

- `R2_ACCOUNT_ID`
- `R2_BUCKET`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_PUBLIC_URL`

To rotate:

1. In Cloudflare: **R2 → Manage R2 API Tokens → Create API Token** with
   Object Read & Write on the bucket. Copy the new Access Key + Secret.
2. In GitHub: paste both values into the matching secrets. **Do not delete
   the old token yet.**
3. Trigger a workflow run (`gh workflow run build.yml` or push an empty
   commit) and confirm the new secrets work end-to-end.
4. In Cloudflare: revoke the old API token.

`R2_PUBLIC_URL` only changes if you swap the public hostname (e.g., move
from `pub-*.r2.dev` to a custom domain). If you change it, also update the
CORS `AllowedOrigins` on the R2 bucket to match the Pages domain.

---

## LFS quota response

The repo is configured with `lfs: ${{ secrets.R2_ACCOUNT_ID == '' }}` in
`build.yml`. When R2 is configured, CI skips LFS entirely. When R2 is
*not* configured, CI pulls LFS and hits the 10 GB/month bandwidth quota
within a few CI runs.

**Symptoms:** workflow fails at the LFS checkout step, or audio 429s on
the live site.

**Response:**

1. **Preferred:** finish the R2 migration (see `DEPLOY.md` §"Migrate
   existing audio to R2"). Once `R2_ACCOUNT_ID` is set, CI auto-stops
   pulling LFS.
2. **Stopgap:** the workflow already falls back to
   `media.githubusercontent.com` for the catalogue's `media_base_url`,
   but that hits the same quota. There's no quick fix without R2.
3. **Last resort:** open a GitHub support ticket to request a quota
   increase — typically denied for free public repos.

---

## "The site is down" runbook

1. **Is Pages up?** Check `https://www.githubstatus.com/`. If GitHub is
   degraded, there is nothing to do but wait.
2. **Is the build green?** `gh run list --limit 5` — look for failed
   workflows on `main`. If the last build failed, the live site is still
   the previous successful artifact. Roll forward with a fix.
3. **Is the catalogue loading?** `curl -I https://<site>/_catalogue/catalogue.json`
   should return 200. If 404 or 5xx, the artifact is broken — trigger a
   re-deploy via `gh workflow run build.yml`.
4. **Is audio loading?** `curl -I` a track URL from `catalogue.json`. If
   404 — R2 sync may have skipped a file; re-run `scripts/sync_r2.py`. If
   429/403 — see LFS quota response above.

---

## Secrets inventory

| Where | What | Used by |
|---|---|---|
| GitHub repo secrets | `R2_*` (5 values) | `build.yml` audio CDN switch |
| Cloudflare | R2 API tokens | `sync_r2.py` upload + `build.yml` |
| Local `.venv` | none (build deps only) | `build_catalogue.py` runtime |

There are no runtime secrets — the deployed site is fully static and
makes no authenticated calls.

---

## Handling email submissions

The Contribute page exposes a "Quiet — email" path
(`mailto:sarang.kernel@gmail.com`) for contributors who don't want to use
GitHub. Submissions arrive as emails with a Drive / Dropbox / WeTransfer
link plus a licence statement. This queue lives in your inbox; surface
it in GitHub so it's visible alongside PRs:

1. **Triage in Gmail.** Filter `subject:"NEIRO — album submission"` →
   apply a label (e.g. `neiro/submission`). Star anything that looks
   in-scope; archive anything that's clearly out of scope.
2. **Open a tracking issue.** From the repo's
   [New Issue](https://github.com/SarangVehale/neiro/issues/new/choose)
   page, pick **"Email submission (maintainer-only)"**. Fill in the
   submitter handle, artist/album, file link, and paste their licence
   statement verbatim. Status starts as `received — awaiting download`.
3. **Download + stage.** Pull the files from the link into
   `music/<Artist>/<Album>/`, add `meta.yaml`, run
   `python scripts/lint_meta.py music/<Artist>/<Album>/meta.yaml` to
   catch authoring errors before the PR step.
4. **Update the issue.** Move the status dropdown forward as you go
   (`downloaded → encoded → PR open → merged`). The queue is visible at
   [issues?label=email-queue](https://github.com/SarangVehale/neiro/issues?q=is%3Aissue+label%3Aemail-queue).
5. **Open the PR** the normal way (push to a feature branch). Link the
   tracking issue with `Closes #<n>` in the PR body so the issue auto-
   resolves on merge.

If the email queue grows past ~3 per week and becomes a bottleneck, the
upgrade path is a forwarder (e.g. `contribute@neiro.music` once a domain
is set up) with a simple filter that auto-opens these issues. Until
then, the manual loop above is the operational pattern.

---

## Adding new music

See `DEPLOY.md` §"Adding music after initial setup". Operational notes:

- Rebuild the catalogue locally (`python scripts/build_catalogue.py`) and
  commit the regenerated `_catalogue/catalogue.json` plus any new
  `public/_thumbs/*.jpg` files. CI does **not** rebuild the catalogue.
- The build script warns on stdout when an album has no resolvable cover
  art (no `cover.jpg`, no embedded art in the first track). Add a
  `cover.jpg` to the album dir to fix.
- The `_thumbs` sweep step removes any thumb file not referenced by the
  current catalogue — safe to run repeatedly.

---

## Long-term failure modes

What's likely to silently degrade or fail over months/years if nobody
touches it. Each row lists the failure, the warning sign, and the
single thing that fixes it.

| Risk | Warning sign | Mitigation | Status |
|---|---|---|---|
| **LFS bandwidth quota** (10 GB/mo) exhausted by visitor traffic | Audio 429s on live site, build workflow fails at LFS checkout step | Execute `docs/R2_MIGRATION.md` — tooling and CI conditional are ready, secrets just need to be set | ⏰ pressing — at ~70% as of last check |
| **LFS storage quota** (10 GB) exhausted | Push rejected: `GH008: This repository has exceeded its LFS quota` | Same R2 migration purges audio from LFS and reclaims space | ⏰ ~57% (5.7 GB of 10 GB) |
| **GitHub Pages outage** | Live site 5xx; no announcement, no SLA | Wayback monthly mirror — first auto-run 2026-06-01 03:17 UTC; `archive.yml` cron. README points users at `web.archive.org/web/*/sarangvehale.github.io/neiro/` | ✅ in place |
| **Google Fonts removes a referenced weight** | Text falls back to system font silently | `font-display: swap` keeps the page usable. Could self-host woff2 files (~230 KB) to remove the dep | 🟡 acceptable |
| **Stale service worker on returning visitors** | Users see old chrome after a deploy until SW updates | Bump `VERSION` in `public/sw.js` on every shell-affecting change | 🟡 manual — easy to forget |
| **Python build deps drift** (mutagen, Pillow, PyYAML) | Build script crashes on a clean install, or thumb hashes shift after `pip install` | Pin versions in `requirements.txt`; add Dependabot for pip ecosystem in `.github/dependabot.yml` | ❌ not pinned, no pip Dependabot |
| **Hardcoded email** (`sarang.kernel@gmail.com`) | Email path silently breaks if address changes | Lives in `public/neiro.js`, `docs/OPERATIONS.md`, `.github/ISSUE_TEMPLATE/email-submission.yml`. Grep before changing; ideally consolidate into a single config | 🟡 known, search-and-replace required |
| **Hardcoded GitHub username** (`SarangVehale`) | All deploy URLs, issue links, archive snapshots break on account rename | Same as above — grep first. The mirror archive doesn't rotate; old snapshots stay accessible | 🟡 known |
| **New audio format** (`.ogg`, `.opus`, `.wav`) added under `music/` | File silently ignored — doesn't appear in catalogue | Update `AUDIO_EXT` in `scripts/build_catalogue.py` + the validator in `validate-pr.yml` + drop-zone `accept=` in `neiro.js` | 🟡 trivial fix when needed |
| **New binary asset format under `public/`** (`.heic`, `.avif`, `.webm`) | If LFS-tracked, Pages serves the 129-byte stub | CI guard in `build.yml` covers `jpg/png/gif/webp/ico`; extend the find filter when new types land | 🟡 trivial fix when needed |
| **Bus-factor 1** | No co-maintainer; R2 secrets, Cloudflare login, Gmail filters all live with one person | `docs/AUDIT.md` §6.1 flags this. Documented hand-off (where the secrets live, how to rotate, who has Pages publish rights) is overdue | ❌ no co-maintainer listed |
| **Archive workflow silently 4xx-ing** | All 4 Wayback Save requests come back non-200 but the workflow still reports success because the loop swallows curl errors | Tighten `archive.yml` to assert at least one snapshot per quarter via `archive.org/wayback/available` | 🟡 acceptable — re-tries monthly anyway |
| **Catalogue.json grows past 1 MB** | Page TTFB rises; SW cache miss costs more | Currently 174 KB. Sharding the catalogue by artist becomes attractive past ~2 MB | 🟡 no action needed yet |

### Most pressing item

**R2 migration.** Everything else is either green or trivially fixable
when it surfaces. R2 is the only item where doing nothing leads to a
hard failure: audio breaks for users when LFS bandwidth runs out, and
the only recovery is the migration that's already documented and ready
to execute.
