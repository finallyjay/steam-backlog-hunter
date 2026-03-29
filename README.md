# Steam Backlog Hunter

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
| Linting         | ESLint + Prettier                                                                                                 |
| CI/CD           | GitHub Actions                                                                                                    |
| Package Manager | pnpm 10.25                                                                                                        |

## Prerequisites

- Node.js `24.13.1` (see `.nvmrc`)
- pnpm `10.25.0`

## Getting Started

```bash
# Clone and install
git clone https://github.com/finallyjay/steam-achievements-tracker.git
cd steam-achievements-tracker
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

| Variable              | Required   | Description                                                               |
| --------------------- | ---------- | ------------------------------------------------------------------------- |
| `STEAM_API_KEY`       | Yes        | Steam Web API key ([get one here](https://steamcommunity.com/dev/apikey)) |
| `STEAM_WHITELIST_IDS` | Yes        | Comma-separated Steam64 IDs allowed to sign in                            |
| `NEXTAUTH_URL`        | Production | Your app's public URL (e.g. `https://steam.example.com`)                  |
| `SQLITE_PATH`         | No         | Custom SQLite database path (see [Database](#database))                   |
| `ADMIN_STEAM_ID`      | No         | Steam64 ID with admin access (`/admin` user management)                   |
| `LOG_LEVEL`           | No         | Pino log level (default: `info`)                                          |

## Scripts

| Command             | Description                          |
| ------------------- | ------------------------------------ |
| `pnpm dev`          | Start development server             |
| `pnpm build`        | Production build (standalone output) |
| `pnpm start`        | Run production server                |
| `pnpm lint`         | ESLint + TypeScript typecheck        |
| `pnpm test`         | Run test suite (Vitest)              |
| `pnpm typecheck`    | Type generation + `tsc --noEmit`     |
| `pnpm format`       | Format codebase with Prettier        |
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

All data endpoints require authentication via `steam_user` httpOnly cookie. JSDoc documentation is available on every route handler and public function.

### Authentication

| Method | Path                       | Description                                               |
| ------ | -------------------------- | --------------------------------------------------------- |
| `GET`  | `/api/auth/steam`          | Initiate Steam OpenID login (rate limited: 10/min per IP) |
| `GET`  | `/api/auth/steam/callback` | Handle OpenID callback (CSRF nonce validated)             |
| `POST` | `/api/auth/logout`         | Clear session cookie                                      |
| `GET`  | `/api/auth/me`             | Get current authenticated user                            |

### Steam Data

| Method | Path                                         | Description                                           |
| ------ | -------------------------------------------- | ----------------------------------------------------- |
| `GET`  | `/api/steam/games?type=recent\|all`          | List owned or recently played games                   |
| `GET`  | `/api/steam/achievements?appId=N`            | Get achievements for a game                           |
| `GET`  | `/api/steam/achievements/batch?appIds=1,2,3` | Batch get achievements (max 200)                      |
| `GET`  | `/api/steam/game/:id`                        | Get single game details                               |
| `GET`  | `/api/steam/stats`                           | Get aggregated user stats                             |
| `GET`  | `/api/steam/sync`                            | Get last sync timestamps                              |
| `POST` | `/api/steam/sync`                            | Trigger full data sync (rate limited: 5/min per user) |

### Infrastructure

| Method | Path          | Description                                 |
| ------ | ------------- | ------------------------------------------- |
| `GET`  | `/api/health` | Health check (SQLite connectivity, no auth) |

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

Schema changes are managed through a **versioned migration system** (`lib/server/sqlite.ts`). A `schema_migrations` table tracks which migrations have run. Each migration executes exactly once, in order, inside a transaction.

To add a new migration, append a function to the `migrations` array in `sqlite.ts`. Never modify existing migrations.

### Path Resolution

1. `SQLITE_PATH` environment variable
2. `/data/steam-achievements-tracker.sqlite` (if `/data` is writable — containerized deployments)
3. `.data/steam-achievements-tracker.sqlite` (project directory fallback)

### Tables

`steam_profile` · `games` · `user_games` · `recent_games_snapshot` · `stats_snapshot` · `schema_migrations`

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
4. Pre-commit hooks will run Prettier and ESLint automatically
5. Create an issue first, then open a Pull Request that closes it

CI runs `lint → test → build` on all PRs.

## License

This project is licensed under the [MIT License](LICENSE).
