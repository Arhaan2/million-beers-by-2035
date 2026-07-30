# Security policy

## Threat model

The dashboard and all summary data are intentionally public. Write access is limited by a shared crew code, short-lived signed sessions, origin checks, rate limits, input validation, idempotency, and constrained database operations. There is no API for rewriting or deleting the event ledger.

The shared code protects against casual unauthorized updates; it is not individual identity, multifactor authentication, or strong authorization. A four-digit code is lightweight access control. Replace the initial crew code with a longer, less guessable value before sharing the project broadly.

## Controls and limitations

- Login failures are limited per salted IP hash. Mutation attempts are limited by a salted hash of IP plus session token ID.
- Raw IP addresses are never stored. Salted hashes remain operational metadata and are not exposed through the API.
- Editor sessions expire after the configured TTL (12 hours by default) and are stored only in browser `sessionStorage`.
- The crew code, signing secret, and rate-limit salt are Cloudflare Worker secrets. They must never be stored in Vite variables, GitHub Actions variables, commits, browser storage, API responses, or application logs.
- CORS rejects unapproved browser origins, but CORS is not authentication.
- Rate limits reduce opportunistic brute force. They cannot guarantee protection against a distributed brute-force attack across many IP addresses.
- The public display escapes contributor names and notes through React's normal rendering path.
- The shared editor session authorizes every allocation in a group entry. It does not cryptographically identify the person submitting it.
- Participant names are unverified display labels, not user accounts or identities.
- Group allocation tracks beer counts only. It does not add payments, debts, reimbursements, or financial-settlement behavior.

## Secret rotation

Rotate the crew code:

```bash
cd apps/api && npx wrangler secret put BEER_ADMIN_PIN
```

Rotate `SESSION_SIGNING_SECRET` to revoke every issued editor session. Rotate `RATE_LIMIT_SALT` if its confidentiality is in doubt; existing rate-limit hashes will naturally be replaced as clients make requests.

After suspected leakage, rotate all affected values, redeploy, inspect Worker logs for sanitized error categories only, and review repository history and artifacts.

## Checking repository history

Search the current tree and full history before publication:

```bash
git grep -n -I -E 'SESSION_SIGNING_SECRET|RATE_LIMIT_SALT|BEER_ADMIN_PIN'
git log -p --all | grep -E 'Authorization: Bearer|CF_API_TOKEN|SESSION_SIGNING_SECRET|RATE_LIMIT_SALT'
```

Configuration key names and safe instructions are expected; live values are not. If a secret ever entered Git history, treat it as compromised even after removing the file. Rotate it immediately, then use a history-rewriting process only after coordinating with every repository user.

## Reporting a vulnerability

Do not open a public issue containing exploit details, credentials, personal data, or tokens. Use GitHub's private vulnerability reporting feature for this repository. Include affected endpoints, reproduction steps, impact, and any suggested mitigation. You should receive an acknowledgment within seven days.

## Supported version

Security updates target the current `main` branch and the live Worker/Pages deployment.
