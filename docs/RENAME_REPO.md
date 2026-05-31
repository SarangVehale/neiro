# Renaming the GitHub repo: `hibiki` → `neiro`

The code-side rename (files, strings, SW version) landed in a single
commit. This doc covers the **manual steps you do on GitHub and on
your local machine** to finish the cutover.

> **Sequencing note:** if you have not yet completed the R2 migration
> (`docs/R2_MIGRATION.md` §3–§5), the media URL in `catalogue.json`
> still embeds the repo name as
> `media.githubusercontent.com/media/SarangVehale/<repo>/main/...`.
> `build.yml` rebuilds it from `${{ github.repository }}` on every push,
> so within ~2 minutes of any commit after the rename, the audio URLs
> heal automatically. Worst case: audio playback fails for a 1–2 minute
> window if a user loads a stale catalogue between the rename and the
> next CI run. Trigger a manual build right after rename to minimize
> the window.

---

## 1. Rename the repo on GitHub

**Via the web UI** (easiest):

1. <https://github.com/SarangVehale/hibiki/settings>
2. Scroll to **Repository name**.
3. Change `hibiki` → `neiro`. Click **Rename**.
4. GitHub auto-sets up redirects for:
   - The web URL `github.com/SarangVehale/hibiki/*`
   - Git operations (clone/pull/push against the old URL still work)
   - The Pages URL `sarangvehale.github.io/hibiki/*` → `/neiro/*`

**Via the CLI**:

```bash
# Once gh is installed:
gh api -X PATCH repos/SarangVehale/hibiki -f name=neiro
```

---

## 2. Update the local git remote

```bash
cd /home/sarang/Development/hibiki-music
git remote set-url origin git@github.com:SarangVehale/neiro.git
git remote -v   # confirm
git fetch       # sanity check
```

The local working directory name (`hibiki-music`) doesn't affect
anything — leave it or rename to `neiro-music`; nothing references the
dir name.

---

## 3. Trigger a fresh build to bake the new media URL

```bash
gh workflow run build.yml --ref main
# or: push an empty commit
git commit --allow-empty -m "chore: bake neiro media URL into catalogue"
git push
```

After the workflow finishes (~1–2 min), verify:

```bash
curl -s https://sarangvehale.github.io/neiro/_catalogue/catalogue.json \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['meta']['media_base_url'])"
# expect (pre-R2):  https://media.githubusercontent.com/media/SarangVehale/neiro/main
# expect (post-R2): https://<R2_PUBLIC_URL>
```

---

## 4. Update Cloudflare R2 (only if you've completed R2 setup)

- **CORS**: `AllowedOrigins` is keyed on `sarangvehale.github.io` — the
  origin doesn't change with the repo rename. **No change needed.**
- **Bucket name**: If you named the bucket `hibiki-music`, you may want
  to also rename to `neiro-music` for consistency. R2 buckets cannot
  be renamed — you'd need to create a new bucket and re-sync (10–20
  min). Optional; the bucket name only appears in the S3 endpoint URL,
  which is internal to `sync_r2.py`.

---

## 5. Update external mentions

After the rename, the following references to the old URL are now
auto-redirected by GitHub but **should still be updated** so search
engines and users land on the canonical URL directly:

- README badges (if any reference `hibiki`)
- Any social profile / portfolio links pointing at the repo
- Wayback Machine: previous snapshots at the old URL are preserved as
  historical record; nothing to do. New snapshots use the new URL
  automatically — the next monthly `archive.yml` cron will pick up
  `/neiro/`.

---

## 6. Sanity sweep

```bash
# Confirm there are no leftover hibiki references in living files
grep -rIn -i "hibiki" \
  --include="*.md" --include="*.yml" --include="*.yaml" \
  --include="*.py" --include="*.html" --include="*.js" \
  --include="*.css" --include="*.json" --include="*.xml" \
  | grep -v "CHANGELOG.md" \
  | grep -v ".claude/"
# Expected output: nothing (CHANGELOG and Claude internal state are
# the only files allowed to retain the historical name)
```

---

## Rollback

If the rename causes a problem you can't fix forward:

```bash
gh api -X PATCH repos/SarangVehale/neiro -f name=hibiki
git remote set-url origin git@github.com:SarangVehale/hibiki.git
```

GitHub rename redirects work in both directions (old name still
resolves to new, new name resolves to old after a re-rename) for at
least the first 90 days. Past that, only the most recent name works.
