# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in steam-backlog-hunter, please report it privately via GitHub's [private vulnerability reporting](https://github.com/finallyjay/steam-backlog-hunter/security/advisories/new) feature. **Do not open a public issue.**

Expect an initial acknowledgement within a few days. This is a personal project maintained in spare time, so response times are best-effort — but credible vulnerability reports will be prioritised over feature work.

## Supported versions

Only the latest commit on `main` is supported. There are no versioned releases.

## Scope

**In scope:**

- The Next.js application (API routes, Steam OpenID auth flow, SQLite storage)
- Dependency vulnerabilities surfaced by Dependabot
- Misuse of the Steam Web API key stored server-side

**Out of scope:**

- Steam Web API vulnerabilities — report those directly to Valve
- Social engineering against project contributors
- Denial of service against any deployed instance
- Issues that require a user to already have admin access to the deployed instance
