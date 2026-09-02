# Steam Backlog Hunter

[![CI](https://github.com/finallyjay/steam-backlog-hunter/actions/workflows/ci.yml/badge.svg)](https://github.com/finallyjay/steam-backlog-hunter/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A self-hosted dashboard for tracking your Steam library, monitoring achievement progress, and hunting down completions.

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Scripts](#scripts)
- [Architecture](#architecture)
- [API Reference](#api-reference)
- [Authentication](#authentication)
- [Database](#database)
- [Deployment](#deployment)
- [Contributing](#contributing)
- [License](#license)

## Features

- **Achievement tracking** — pending, unlocked, and completion status per game
- **Library analytics** — playtime, perfect games, average completion, and indexed totals
- **Steam profile badges** — level badge (official sprites), years of service, and Game Collector with tooltips
- **Recently played** — sorted by actual last played time
- **Filterable library** — multi-toggle state filters (In Progress, Perfect, Untouched), sort options, achievements toggle
- **Game detail pages** — pending/unlocked tabs, progress bar, unlock timestamps, Steam Store link
- **Image discovery** — automatically probes Steam CDN for the best available game art
- **Multi-user ready** — whitelist-based access via Steam OpenID, data fully isolated per user

## Tech Stack

| Category        | Technology                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------- |
| Framework       | [Next.js 16](https://nextjs.org/) (App Router)                                                                    |
| Language        | [TypeScript](https://www.typescriptlang.org/) (strict mode)                                                       |
| UI              | [React 19](https://react.dev/) + [Tailwind CSS 4](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/) |
| Database        | SQLite via Node.js built-in `DatabaseSync`                                                                        |
| Auth            | Steam OpenID 2.0                                                                                                  |
| Testing         | [Vitest](https://vitest.dev/) + Testing Library                                                                   |
| Linting         | [oxlint](https://oxc.rs/docs/guide/usage/linter) + [oxfmt](https://oxc.rs/docs/guide/usage/formatter)             |
| CI/CD           | GitHub Actions                                                                                                    |
| Package Manager | pnpm (version pinned in `packageManager`)                                                                         |

## Prerequisites

- Node.js 24 (see `.nvmrc`; `engines` requires `>=24 <25`)
- pnpm (see `packageManager` in `package.json` — Corepack picks it up automatically)

## Getting Started

```bash
# Clone and install
git clone https://github.com/finallyjay/steam-backlog-hunter.git
cd steam-backlog-hunter
nvm use
pnpm install

# Configure environment
cp .env.local.example .env.local
# Edit .env.local with your values (see Environment Variables below)

# Start development server
pnpm dev
```

The app will be available at `http://localhost:3000`.

## Environment Variables

| Variable              | Required   | Description                                                                     |
| --------------------- | ---------- | ------------------------------------------------------------------------------- |
| `STEAM_API_KEY`       | Yes        | Steam Web API key ([get one here](https://steamcommunity.com/dev/apikey))       |
| `ADMIN_STEAM_ID`      | Yes        | Steam64 ID with admin access (always allowed to sign in + `/admin`)             |
| `NEXTAUTH_URL`        | Production | Your app's public URL (e.g. `https://steam.example.com`)                        |
| `SQLITE_PATH`         | No         | Custom SQLite database path (see [Database](#database))                         |
| `STEAM_WHITELIST_IDS` | No         | Comma-separated Steam64 IDs for initial seed (managed via `/admin` after)       |
| `SESSION_SECRET`      | Production | HMAC key for signing the session cookie (dev/test fall back to `STEAM_API_KEY`) |
| `STEAM_API_LOCALE`    | No         | Locale sent to Steam as `l=` (default: `es`; e.g. `en`, `fr`, `de`)             |
| `LOG_LEVEL`           | No         | Pino log level (default: `info`)                                                |

## Scripts

| Command             | Description                          |
| ------------------- | ------------------------------------ |
| `pnpm dev`          | Start development server             |
| `pnpm build`        | Production build (standalone output) |
| `pnpm start`        | Run production server                |
| `pnpm lint`         | oxlint + TypeScript typecheck        |
| `pnpm test`         | Run test suite (Vitest)              |
| `pnpm typecheck`    | Type generation + `tsc --noEmit`     |
| `pnpm format`       | Format codebase with oxfmt           |
| `pnpm format:check` | Check formatting without writing     |

## Architecture

```
Steam API → SQLite → API Routes → Client Hooks → UI
```

### Project Structure

```
app/
├── api/                    # API routes
│   ├── auth/               #   Steam OpenID login flow
│   ├── steam/              #   Data endpoints (games, achievements, stats, sync)
│   └── health/             #   Infrastructure health check
├── dashboard/              # Dashboard page + error boundary
├── games/                  # Library page with filters
├── game/[id]/              # Game detail page + error boundary
└── page.tsx                # Landing / login

components/
├── dashboard/              # Dashboard-specific components
└── ui/                     # Reusable UI primitives (shadcn/ui)

hooks/                      # Custom React hooks (user state, data fetching)

lib/
├── server/                 # Server-only modules (marked with "server-only")
│   ├── sqlite.ts           #   Database schema and versioned migrations
│   ├── steam-games-sync.ts #   Game ownership sync
│   ├── steam-achievements-sync.ts  # Achievement data sync
│   ├── steam-stats-compute.ts      # Stats aggregation
│   ├── steam-images.ts     #   Image discovery and probing
│   ├── rate-limit.ts       #   In-memory rate limiter
│   └── logger.ts           #   Structured logging (Pino)
├── steam-api.ts            # Direct Steam Web API calls
├── env.ts                  # Zod-validated environment variables
├── whitelist.ts            # Steam ID whitelist enforcement
└── types/                  # TypeScript interfaces
```

### Data Flow

1. **Steam API** is queried when data is stale or a manual refresh is triggered
2. **SQLite** stores all persistent data (games, achievements, schemas, stats, images)
3. **API routes** serve data from SQLite, triggering syncs when needed
4. **Client hooks** manage fetching, caching, deduplication, and cooldowns
5. **UI components** consume hooks and render the dashboard

### Staleness Thresholds

| Data           | TTL        |
| -------------- | ---------- |
| Owned games    | 24 hours   |
| Achievements   | 7 days     |
| Game schemas   | 30 days    |
| Stats snapshot | 15 minutes |
| Game images    | 30 days    |

## API Reference

Every route handler is documented in [`docs/API.md`](docs/API.md) — authentication, Steam data, admin and infrastructure endpoints, with methods, paths and rate limits.

## Authentication

Steam OpenID 2.0 with CSRF nonce protection and timing-safe validation.

- `STEAM_WHITELIST_IDS` controls who can sign in (comma-separated Steam64 IDs)
- If missing or empty, **all access is denied**
- Sessions stored in httpOnly, secure, SameSite cookies (7-day expiry)
- Whitelist is re-validated on every server auth check
- Each user's data is fully isolated by `steam_id`
- Steam level and community badges are fetched at login

## Database

SQLite is the primary store. The schema auto-initializes on first run.

### Migrations

Schema evolution in `lib/server/sqlite.ts` happens in three layers, applied in order on every `getSqliteDatabase()` call:

1. **`createBaseSchema`** — `CREATE TABLE IF NOT EXISTS` statements that define the latest shape for fresh installs. Safe to re-run; a no-op once the tables exist.
2. **`addColumnIfMissing`** (via `applyAdditiveMigrations`) — additive-only column changes for existing databases. Checks `PRAGMA table_info(<table>)` and runs `ALTER TABLE ... ADD COLUMN` only if the column isn't already there.
3. **Versioned data migrations** (the `MIGRATIONS` array, run by `runVersionedMigrations`) — one-off data backfills/fixups tracked via SQLite's built-in `PRAGMA user_version` (no separate table). Each entry has a `version`, a `name`, and a `run(db)` function; on open, every migration whose `version` is greater than the stored `user_version` runs once inside a transaction, then bumps `user_version` to that migration's version.

To add a new column: add it to the relevant `CREATE TABLE` in `createBaseSchema` **and** add an `addColumnIfMissing` call in `applyAdditiveMigrations` so existing databases pick it up. To add a one-off data migration: append an entry to the `MIGRATIONS` array with the next `version` number — never modify or reorder existing entries, since it's an append-only history.

### Path Resolution

1. `SQLITE_PATH` environment variable
2. `/data/steam-backlog-hunter.sqlite` (if `/data` is writable — containerized deployments)
3. `.data/steam-backlog-hunter.sqlite` (project directory fallback)

### Tables

`steam_profile` · `games` · `user_games` · `stats_snapshot` · `hidden_games` · `allowed_users` · `game_achievements` · `user_achievements` · `pinned_games` · `extra_games` · `extra_game_achievements` · `app_catalog_meta`

All user-specific tables are keyed by `steam_id` for multi-user isolation.

## Deployment

### Dokploy / Container

1. Set environment variables in your deployment platform
2. Mount a persistent volume for SQLite (set `SQLITE_PATH` or mount at `/data/`)
3. The app builds as a standalone Next.js output

### Self-hosted

```bash
pnpm build
pnpm start
```

Ensure `NEXTAUTH_URL` matches your public URL for Steam OpenID redirects.

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Commit using [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, etc.)
4. Pre-commit hooks will run oxfmt and oxlint automatically
5. Create an issue first, then open a Pull Request that closes it

CI runs `lint → test → build` on all PRs; pull requests are squash-merged.

## License

This project is licensed under the [MIT License](LICENSE).
