# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev              # Start dev server (localhost:3000)
pnpm build            # Production build (standalone output)
pnpm lint             # ESLint + typecheck (runs both)
pnpm typecheck        # next typegen + tsc --noEmit
pnpm test             # Vitest run (all tests)
pnpm format           # Prettier format all files
pnpm exec vitest run test/<file>.test.ts  # Run single test file
```

CI runs: install → lint → test → build (GitHub Actions, on push to main and PRs).
Pre-commit hooks run Prettier + ESLint via Husky + lint-staged.

## Architecture

Next.js 16 App Router with React 19, TypeScript strict mode, Tailwind CSS 4, shadcn/ui (new-york style) + Radix UI primitives. Uses pnpm 10.25 and Node 24.13.

### Data flow

**Steam API → SQLite → API routes → Client hooks → UI**

- `lib/server/steam-games-sync.ts` — game ownership sync and persistence
- `lib/server/steam-achievements-sync.ts` — achievement data sync, schema management
- `lib/server/steam-stats-compute.ts` — stats aggregation and sync orchestration
- `lib/server/steam-store-utils.ts` — shared utilities (staleness checks, timestamps, profile management)
- `lib/server/steam-store.ts` — barrel re-export of the above modules
- `lib/server/sqlite.ts` — database schema and versioned migrations (Node.js built-in `DatabaseSync`); tables: `steam_profile`, `games`, `user_games`, `recent_games_snapshot`, `stats_snapshot`, `tracked_games`, `schema_migrations`
- `lib/steam-api.ts` — direct Steam Web API calls (shared between server and client for types/utilities)

### API routes (`app/api/`)

- `auth/steam/` — Steam OpenID 2.0 login flow with CSRF nonce, whitelist enforcement, rate limiting
- `steam/games`, `steam/achievements`, `steam/stats`, `steam/sync`, `steam/game/[id]` — data endpoints; all require authenticated session via `steam_user` httpOnly cookie
- `health/` — infrastructure health check (no auth)

### Client state (`hooks/`)

- `use-current-user.ts` — global user state with pub/sub listener pattern and request deduplication
- `use-steam-data.ts` — `useSteamGames`, `useSteamAchievementsBatch`, `useSteamStats` with loading/refreshing states and cooldown between manual refreshes

### Auth model

Whitelist-based, multi-user ready. `STEAM_WHITELIST_IDS` (comma-separated Steam64 IDs) controls access. Empty/missing = access denied. Session stored in httpOnly cookie, re-validated on every server auth check. All user data isolated by `steam_id`.

### Pages

- `/` — landing/login
- `/dashboard` — stats overview with tabs (Overview, Recent, Completion)
- `/games` — full library with filter bar (scope, sort, achievements filter)
- `/game/[id]` — individual game achievement breakdown

### Key conventions

- Path alias: `@/*` maps to project root
- SQLite path resolution: `SQLITE_PATH` env → `/data/` → `.data/` fallback
- Environment variables validated with Zod at startup (`lib/env.ts`)
- Structured logging via Pino (`lib/server/logger.ts`)
- `@next/next/no-img-element` ESLint rule is disabled
- `lib/steam-api.ts` must NOT import `server-only` modules (used by client components for types)
- Tests live in `test/` directory (Vitest + @testing-library/react + jsdom)
- All API routes and public functions have JSDoc documentation
- Database migrations are versioned in `sqlite.ts` — add new migrations to the `migrations` array, never modify existing ones
