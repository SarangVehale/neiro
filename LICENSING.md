# Licensing — code vs. content

## Code: MIT

Everything that isn't music or cover art is under the [MIT licence](LICENSE):
`public/`, `scripts/`, `tests/`, `.github/`, documentation.

## Content: per-album

Audio and cover art under `music/` are donated. Each album declares its
licence in `meta.yaml`:

```yaml
license: CC-BY-4.0
source: "Donated by the artist, Jan 2026."
```

| Value | What it means |
|---|---|
| `CC0-1.0` | Public-domain dedication. No restrictions. |
| `CC-BY-4.0` | Share + adapt with attribution. |
| `CC-BY-SA-4.0` | Same, derivatives must use the same licence. |
| `CC-BY-NC-4.0` | Share + adapt non-commercially. |
| `PD` | Public domain (e.g. expired copyright). |
| `all-rights-reserved-donated` | Hosted with permission; redistribution restricted. |

## Takedown

If you are a rights-holder and find material here you did not licence for
redistribution, please open a confidential
[Security Advisory](https://github.com/SarangVehale/hibiki/security/advisories/new)
or email the maintainer. We will remove it within 72 hours of verification.

## Why this split?

A public archive is mixed: code we author + content we host on others' behalf.
Collapsing them under one licence would either misrepresent who owns the music
or over-constrain reuse of the code. The split keeps each accurate.
