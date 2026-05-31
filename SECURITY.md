# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Instead, open a
[GitHub Security Advisory](https://github.com/SarangVehale/neiro/security/advisories/new)
(Security tab → "Report a vulnerability"). We'll acknowledge within 72 hours
and aim to ship a fix within 14 days for high-severity issues.

## Reporting a takedown / licensing issue

Material that should not be in the archive is not a security issue —
see [LICENSING.md](LICENSING.md) for the takedown process. Both routes are confidential.

## Scope

**In scope:**
- The static site (`public/`) — XSS, mixed content, etc.
- The Python builder — path traversal, zip-slip, malicious tag metadata.
- CI workflows — secret exfiltration, injection in PR titles or commit messages.

**Out of scope:**
- Issues only reachable by an attacker with push access.
- Vulnerabilities in upstream dependencies — report those upstream first.
