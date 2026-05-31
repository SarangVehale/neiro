# Setting up Cloudflare R2 — step-by-step

This is the hand-over-hand version. For the high-level overview see
[DEPLOY.md §"Audio CDN"](DEPLOY.md). When you finish you'll have the **5
values** that go into GitHub Secrets (later) and into
`scripts/sync_r2.py` (now).

Time required: **~15 minutes** if nothing weird happens.

---

## 1. Create the Cloudflare account

1. Open <https://dash.cloudflare.com/sign-up>.
2. Sign up with your email. Verify the email when prompted.
3. You do **not** need to add a domain — R2 works without one.
4. After verification you land on the dashboard. Leave it open.

---

## 2. Note your Account ID — this is `R2_ACCOUNT_ID`

1. In the dashboard right sidebar, find **Account ID**. It's a 32-character
   hex string (e.g. `a1b2c3d4e5f6...`).
2. Click the copy icon next to it.
3. Save it somewhere safe (password manager / `.env.local` / sticky note).

> If you don't see "Account ID" in the sidebar, click **Account Home** in
> the top-left, then scroll down — it's under "API" on that page.

---

## 3. Enable R2 (one click, billing-required-but-free)

1. In the left nav click **R2 Object Storage**.
2. If you see a "Get Started" / "Purchase R2" button, click it.
3. Cloudflare asks for a credit card. **R2's free tier covers our usage**
   (10 GB storage, infinite egress). The card is on file in case you
   exceed the free tier, but you will not be charged for normal NEIRO
   traffic.
4. Once enabled, you'll be on the R2 dashboard with **0 buckets**.

---

## 4. Create the bucket — name is `R2_BUCKET`

1. Click **Create bucket** (top right).
2. Bucket name: `neiro-music` (matches the repo's intended rename).
   - Lowercase, hyphens OK, no underscores or dots.
3. **Location**: leave as **Automatic** unless you have a strong reason.
4. **Storage class**: **Standard**.
5. **Default encryption**: leave default.
6. Click **Create bucket**.

> If `neiro-music` is taken globally, try `neiro-music-archive` or
> `neiro-audio-vault`. Whatever you pick goes into `R2_BUCKET`.

---

## 5. Enable public access — gives you `R2_PUBLIC_URL`

This is what lets the browser stream audio directly without a signed URL.

1. On your bucket page, click the **Settings** tab.
2. Scroll to **Public access**.
3. Click **Allow Access** under "R2.dev subdomain".
4. Read the warning, type the bucket name to confirm, click **Allow**.
5. Cloudflare gives you a URL like
   `https://pub-abcd1234567890.r2.dev`.
   **Copy it — this is `R2_PUBLIC_URL`.** No trailing slash.

> **Optional but recommended** — connect a custom subdomain (e.g.
> `cdn.your-domain.tld`) so the URL isn't `pub-xxx.r2.dev`. Skip for now;
> you can swap `R2_PUBLIC_URL` later without re-uploading anything.

---

## 6. Create the API token — gives you `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY`

1. Back at the R2 dashboard, click **Manage R2 API Tokens** (top right of
   the R2 home page, may be under "..." menu).
2. Click **Create API Token**.
3. **Token name**: `neiro-sync` (any name; this is for your reference).
4. **Permissions**: **Object Read & Write**.
5. **Specify bucket**: pick **Apply to specific buckets only** → choose
   `neiro-music` (least-privilege; the token can't touch other buckets).
6. **TTL**: leave **Forever** (or set an expiry if you'll rotate).
7. **Client IP filtering**: skip unless you know what you're doing.
8. Click **Create API Token**.
9. **A page appears with the keys ONCE.** Copy both:
   - **Access Key ID** → `R2_ACCESS_KEY_ID` (20-ish chars)
   - **Secret Access Key** → `R2_SECRET_ACCESS_KEY` (longer, ~40 chars)
10. Below those two, Cloudflare also shows the
    **Endpoint** for S3 clients. You don't need this — `sync_r2.py`
    builds it from `R2_ACCOUNT_ID`. Just confirm it matches
    `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`.

> If you lose the Secret Access Key, you have to delete and recreate the
> token. Cloudflare does not let you see it again.

---

## 7. Set CORS on the bucket

This lets the browser fetch audio from R2 when the page is served from
GitHub Pages.

1. On the bucket page → **Settings** → scroll to **CORS Policy**.
2. Click **Add CORS policy** (or **Edit** if a placeholder exists).
3. Paste:
   ```json
   [
     {
       "AllowedOrigins": [
         "https://sarangvehale.github.io",
         "http://localhost:8000"
       ],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedHeaders": ["Range"],
       "ExposeHeaders": ["Content-Length", "Content-Range", "Accept-Ranges"],
       "MaxAgeSeconds": 86400
     }
   ]
   ```
4. Click **Save**.

> After the repo rename to `neiro`, `AllowedOrigins` stays the same — the
> Pages origin is `sarangvehale.github.io` whether the repo is `hibiki`
> or `neiro`. The path changes; the origin doesn't.

---

## 8. Final inventory — confirm you have all 5

Open a new terminal and paste these one at a time:

```bash
export R2_ACCOUNT_ID="..."         # from §2
export R2_BUCKET="neiro-music"     # from §4
export R2_PUBLIC_URL="https://pub-...r2.dev"  # from §5, no trailing slash
export R2_ACCESS_KEY_ID="..."      # from §6
export R2_SECRET_ACCESS_KEY="..."  # from §6
```

Sanity test — list the bucket (should print nothing the first time):

```bash
cd /home/sarang/Development/hibiki-music
.venv/bin/python -c "
import os, boto3
c = boto3.client('s3',
    endpoint_url=f'https://{os.environ[\"R2_ACCOUNT_ID\"]}.r2.cloudflarestorage.com',
    aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
    aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],
    region_name='auto')
print(c.list_objects_v2(Bucket=os.environ['R2_BUCKET']).get('KeyCount', 0), 'objects')
"
```

- `0 objects` → ✅ token works, bucket is empty.
- `AccessDenied` → token doesn't have the right bucket. Re-do §6, pick
  the bucket explicitly.
- `InvalidAccessKeyId` → typo in `R2_ACCESS_KEY_ID`.
- `NoSuchBucket` → typo in `R2_BUCKET`.

---

## 9. Run the migration (back to the main checklist)

Once §8 prints `0 objects`, continue from
[R2_MIGRATION.md §3 (Dry-run R2 sync)](R2_MIGRATION.md#3-dry-run-r2-sync).

After §5 (CI cutover), add the same five values as GitHub repository
secrets:

```bash
# Install gh CLI first if you don't have it:
#   pacman -S github-cli   (Arch)
#   apt install gh         (Debian/Ubuntu)
gh secret set R2_ACCOUNT_ID         --body "$R2_ACCOUNT_ID"
gh secret set R2_BUCKET             --body "$R2_BUCKET"
gh secret set R2_ACCESS_KEY_ID      --body "$R2_ACCESS_KEY_ID"
gh secret set R2_SECRET_ACCESS_KEY  --body "$R2_SECRET_ACCESS_KEY"
gh secret set R2_PUBLIC_URL         --body "$R2_PUBLIC_URL"
```

Or do it manually under **Settings → Secrets and variables → Actions →
New repository secret** for each.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `curl pub-xxx.r2.dev/music/foo.mp3` → 403 | Public access not enabled | Re-do §5 |
| `curl ...` → 200 but browser CORS error | CORS policy missing the page origin | §7, add origin |
| `upload_file` → SignatureDoesNotMatch | Account ID typo in endpoint URL | §2, re-copy |
| First track loads, second 416 Range | `Accept-Ranges` not exposed in CORS | §7, add to ExposeHeaders |
| All uploads suddenly fail with 401 | Token expired (if you set a TTL) | §6, create new token |

Related: [SETUP_INTERNET_ARCHIVE.md](SETUP_INTERNET_ARCHIVE.md) for the
cold-tier backup.
