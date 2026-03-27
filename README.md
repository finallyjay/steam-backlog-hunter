# Steam Backlog Hunter

A personal dashboard for tracking your Steam library, monitoring achievement progress, and hunting down completions. Sign in with Steam, sync your library, and see what's left to finish.

## Features

- **Achievement tracking** — pending, unlocked, and completion status per game
- **Library analytics** — playtime, perfect games, average completion, and indexed totals
- **Recently played** — sorted by actual last played time (`rtime_last_played`)
- **Completion opportunities** — surfaces games closest to 100% from recent activity
- **Game detail pages** — pending/unlocked tabs, progress bar, unlock timestamps, Steam Store link
- **Image discovery** — automatically probes Steam CDN for the best available game art
- **Single-user** — whitelist-based access via Steam OpenID, designed for self-hosting

## Tech Stack

Next.js 16 (App Router) | React 19 | TypeScript | Tailwind CSS 4 | SQLite (Node.js built-in) | shadcn/ui

## Getting Started

### Requirements

- Node `24.13.1` (see `.nvmrc`)
- pnpm `10.25.0`

### Setup

```bash
nvm use
pnpm install
```

### Environment Variables

Create a `.env.local` file:

```bash
STEAM_API_KEY=your_steam_web_api_key        # from https://steamcommunity.com/dev/apikey
NEXTAUTH_URL=http://localhost:3000           # your app URL (required for production)
STEAM_WHITELIST_IDS=76561198000000000        # comma-separated Steam64 IDs
SQLITE_PATH=/path/to/database.sqlite        # optional, see below
```

### Run

```bash
pnpm dev      # http://localhost:3000
```

## Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start development server |
| `pnpm build` | Production build |
| `pnpm start` | Run production server |
| `pnpm lint` | ESLint + typecheck |
| `pnpm test` | Run tests (Vitest) |

## Auth + Whitelist

- `STEAM_WHITELIST_IDS` controls who can sign in (comma-separated Steam64 IDs)
- If missing or empty, **all access is denied** by default
- Non-whitelisted users are redirected to `/?error=not_whitelisted`
- Sessions are re-validated on every auth check

## SQLite Persistence

SQLite is the primary store for owned games, achievement snapshots, game schemas, image URLs, and aggregated stats. Path resolution order:

1. `SQLITE_PATH` environment variable
2. `/data/steam-achievements-tracker.sqlite` (if `/data` is writable)
3. `.data/steam-achievements-tracker.sqlite` (project directory)

For containerized deployments (Dokploy, Nixpacks), mount a persistent volume and set `SQLITE_PATH`.

The first sync populates the database from the Steam API. After that, reads come from SQLite and Steam is only queried when data is stale or manually refreshed.

## Sync

- **Manual sync**: `POST /api/steam/sync` refreshes owned games, achievements, and stats
- **Sync status**: `GET /api/steam/sync` returns last sync timestamps

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on push and PRs:

`install` → `lint` → `test` → `build`
