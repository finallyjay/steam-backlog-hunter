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
SQLITE_PATH=/absolute/path/to/steam-achievements-tracker.sqlite
```

Use a standard Redis connection URL (works with self-hosted Redis, Dokploy service Redis, managed Redis providers, and `rediss://` URLs).

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

## SQLite Persistence

- SQLite is the primary persistent store for owned games, achievement snapshots, schemas, and aggregated stats.
- Default path resolution:
1. `SQLITE_PATH`, if set
2. `/data/steam-achievements-tracker.sqlite`, if `/data` exists and is writable
3. `.data/steam-achievements-tracker.sqlite` inside the project directory
- For Dokploy/Nixpacks, mount a persistent volume and point `SQLITE_PATH` to that volume. A safe default is `/data/steam-achievements-tracker.sqlite`.
- The first requests populate the database; after that, reads come from SQLite and Steam is only queried on stale data or manual refresh.

## Manual Resync

- `POST /api/steam/sync` forces a full sync for the authenticated user and refreshes owned games, recent games, achievements, and stats snapshots.
- `GET /api/steam/sync` returns the timestamps of the last owned-games, recent-games, and stats syncs so the UI can show sync state.

## CI

GitHub Actions workflow: `.github/workflows/ci.yml`

On push/PR it runs:
1. `pnpm install --frozen-lockfile`
2. `pnpm lint`
3. `pnpm test`
4. `pnpm build`
