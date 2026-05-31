# Setting up the GitLab warm-backup mirror

Tier 2 of the 3-point backup architecture
(LFS hot / **GitLab warm** / IA cold). A full git mirror including
LFS-tracked audio lives on GitLab. If GitHub goes down, gets you kicked
off, or simply rate-limits, the entire repo is one `git clone` away
from a second host.

GitLab Free includes **10 GB total storage** + **5 GB LFS** per project
+ unlimited public bandwidth. No credit card required.

Time required: **~20 minutes** account + repo setup, then **2–4 hours**
for the initial 5.7 GB LFS push (do this locally, not via CI — see §4).

---

## 1. Create the GitLab account

1. Open <https://gitlab.com/users/sign_up>.
2. Sign up with email or via GitHub OAuth.
3. **No credit card prompt** — confirm this; if it asks for a card you
   accidentally clicked "Premium trial". Back out.
4. Verify email when prompted.
5. Choose username (e.g. `sarang-kernel` to match the rest).

---

## 2. Create the mirror repo on GitLab

1. **+ → New project → Create blank project**.
2. **Project name**: `neiro` (or `neiro-mirror` if you want the role
   obvious in the URL).
3. **Visibility**: **Public**. This matches GitHub and lets anonymous
   clones recover the repo without auth.
4. **Initialize repository with a README**: **uncheck** (we're going
   to mirror, not start fresh).
5. Click **Create project**.
6. Copy the HTTPS clone URL from the project page — it looks like
   `https://gitlab.com/sarang-kernel/neiro.git`. This is your
   `GITLAB_REPO_URL`.

---

## 3. Create a Personal Access Token — gives you `GITLAB_TOKEN`

GitLab CI pushes need an auth token, not a password.

1. **User avatar (top right) → Edit profile → Access Tokens**.
2. Click **Add new token**.
3. **Token name**: `neiro-github-mirror`.
4. **Expiration date**: pick **1 year** (set a calendar reminder to
   rotate; tokens with no expiry aren't allowed on GitLab Free).
5. **Scopes**: tick **`write_repository`** (lets it push refs + LFS).
   Do NOT tick `api` — least privilege.
6. Click **Create personal access token**.
7. **Copy the token immediately.** GitLab shows it once. Lose it →
   delete and create a new one.

```bash
export GITLAB_TOKEN="glpat-..."
export GITLAB_REPO_URL="https://gitlab.com/sarang-kernel/neiro.git"
```

---

## 4. **Initial LFS push from your laptop** (one-time, ~2 h)

This step is critical — running it on a GitHub-hosted CI runner would
pull 5.7 GB of LFS objects through GitHub's bandwidth quota in one
shot, burning the entire monthly allowance. Doing it from your own
machine bypasses the quota entirely.

```bash
cd /home/sarang/Development/hibiki-music

# Add the GitLab mirror as a second remote
git remote add gitlab "$GITLAB_REPO_URL"

# One-time auth: cache the token so subsequent pushes don't re-prompt
git config --global credential.helper store
# When git prompts on first push:
#   Username: oauth2
#   Password: <paste $GITLAB_TOKEN>

# Configure the push refspec so `git push gitlab` only mirrors local
# branches + tags — never your `origin/...` remote-tracking refs.
# (Do NOT use `git push --mirror gitlab` from a non-bare clone: it
# pushes `refs/remotes/origin/*` as branches literally named
# `origin/dependabot/...`, which GitLab will reject.)
git config --add remote.gitlab.push 'refs/heads/*:refs/heads/*'
git config --add remote.gitlab.push 'refs/tags/*:refs/tags/*'

# Push every local branch + tag
git push gitlab

# Then push LFS objects (5.7 GB → 1–4 h depending on uplink)
git lfs push --all gitlab
```

Verify:

```bash
# In a scratch directory, prove the mirror is fully usable
cd /tmp
git clone "$GITLAB_REPO_URL" neiro-test
cd neiro-test
git lfs pull
ls music/Pex/   # should show the actual .mp3 file, not a pointer stub
cd .. && rm -rf neiro-test
```

If the test clone has real audio bytes, the mirror works. Subsequent
pushes from CI (§5) only ship deltas — typically a few MB.

---

## 5. Add CI secrets — enables the per-push mirror

```bash
# Manually: Settings → Secrets and variables → Actions → New repository
# secret. Add both values.

# Or via gh CLI once installed:
gh secret set GITLAB_TOKEN    --body "$GITLAB_TOKEN"
gh secret set GITLAB_REPO_URL --body "$GITLAB_REPO_URL"
```

The workflow `.github/workflows/mirror-gitlab.yml` then fires on every
push to `main`. It only pulls LFS into the runner when the push
includes audio changes; doc/code pushes use refs-only mirroring (no
LFS bandwidth).

Verify by visiting <https://gitlab.com/sarang-kernel/neiro/-/commits/main>
after the next push — should match `https://github.com/SarangVehale/neiro`.

---

## 6. Recovery — restoring from GitLab if GitHub dies

If you just need a working copy:

```bash
# Mirror is a full clone of everything — code, history, LFS objects.
git clone https://gitlab.com/sarang-kernel/neiro.git
cd neiro
git lfs pull
```

If you need to **repopulate a fresh GitHub repo** from the GitLab mirror,
clone *as a bare mirror* first — that way `push --mirror` only carries
real `refs/heads/*` and `refs/tags/*`, not remote-tracking refs:

```bash
git clone --mirror https://gitlab.com/sarang-kernel/neiro.git
cd neiro.git
git lfs fetch --all
git remote set-url origin git@github.com:YOUR/neiro.git
git push --mirror origin
git lfs push --all origin
```

> **Realistic expectation**: GitLab's free tier serves clones at a
> decent rate. Restoring 5.7 GB takes ~10–30 min depending on your
> connection. Faster than IA's recovery path (~20 min) because GitLab
> supports git-native delta pulls.

---

## 7. Monthly check (5 min, optional)

Once a quarter, verify the mirror is healthy:

1. Visit <https://gitlab.com/sarang-kernel/neiro> — commits up to date?
2. Check the project's **Settings → Usage Quotas** — make sure storage
   is well under 10 GB and LFS under 5 GB.
3. Confirm token expiry isn't approaching. Rotate via §3 if it is.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `git lfs push` → `403 Forbidden` | Token scope missing — re-do §3 with `write_repository` checked |
| `git push gitlab main` → `repository not found` | URL typo, or repo visibility set to private without auth in URL |
| GitHub Action workflow fails with `denied` | `GITLAB_TOKEN` secret expired — rotate via §3 |
| GitLab refuses LFS push, "quota exceeded" | LFS storage > 5 GB — either pay $19/mo for Premium or prune historical LFS objects from the GitLab side only |
| `git push gitlab` is very slow | Normal for the first push (~1 MB/s). Subsequent pushes are fast (delta-only) |

Related: [SETUP_INTERNET_ARCHIVE.md](SETUP_INTERNET_ARCHIVE.md) for the
cold tier. [SETUP_R2.md](SETUP_R2.md) for the deferred R2 path.
