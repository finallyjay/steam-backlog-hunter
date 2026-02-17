# Steam Achievements Tracker

Track Steam games and achievements after signing in with Steam OpenID.

## Requirements

- Node `24.13.1` (see `.nvmrc`)
- pnpm `10.25.0`

### Recommended setup

```bash
nvm use
pnpm install
```

## Environment Variables

Create a `.env.local` file:

```bash
STEAM_API_KEY=your_steam_web_api_key
NEXTAUTH_URL=http://localhost:3000
STEAM_WHITELIST_IDS=76561198000000000,76561198000000001
```

## Local Commands

- `pnpm dev`: start local development server
- `pnpm lint`: run ESLint + typecheck
- `pnpm test`: run unit/smoke tests with Vitest
- `pnpm build`: production build
- `pnpm start`: run production server

## Auth + Whitelist Behavior

- `STEAM_WHITELIST_IDS` is a comma-separated list of allowed Steam64 IDs.
- Spaces and empty entries are ignored.
- If `STEAM_WHITELIST_IDS` is missing/empty, access is denied by default.
- Whitelist is checked in Steam callback before writing session cookie.
- Non-whitelisted users are redirected to `/?error=not_whitelisted`.
- Existing sessions are re-validated when reading auth state and are cleared if no longer authorized.

## CI

GitHub Actions workflow: `.github/workflows/ci.yml`

On push/PR it runs:
1. `pnpm install --frozen-lockfile`
2. `pnpm lint`
3. `pnpm test`
4. `pnpm build`
