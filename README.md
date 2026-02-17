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
REDIS_URL=https://your-upstash-redis-url
REDIS_TOKEN=your_upstash_redis_token
```

`REDIS_TOKEN` is provider-specific. With Upstash REST Redis, both `REDIS_URL` and `REDIS_TOKEN` are required.

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

## Redis Cache Persistence

- Redis is used as a read-through cache (Steam is still source of truth).
- Cache key namespace: `sat:v1:*`
- TTL defaults:
1. Stats: 2 minutes
2. Games (`recent` / `all`): 10 minutes
3. Achievements: 10 minutes
- Manual refresh in UI sends `refresh=1` and bypasses cache reads for that request.
- If Redis is not configured or unavailable, API routes fall back to direct Steam fetches.

### Cache Flush Runbook

For emergency invalidation, delete keys by prefix:

```bash
redis-cli --scan --pattern 'sat:v1:*' | xargs redis-cli del
```

If your provider does not expose `redis-cli`, use its dashboard/CLI to remove the same prefix pattern.

## CI

GitHub Actions workflow: `.github/workflows/ci.yml`

On push/PR it runs:
1. `pnpm install --frozen-lockfile`
2. `pnpm lint`
3. `pnpm test`
4. `pnpm build`
