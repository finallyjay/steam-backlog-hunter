# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev              # Start dev server (localhost:3000)
pnpm build            # Production build (standalone output)
pnpm lint             # oxlint + typecheck (runs both)
pnpm typecheck        # next typegen + tsc --noEmit
pnpm test             # Vitest run (all tests)
pnpm format           # oxfmt format all files
pnpm exec vitest run test/<file>.test.ts  # Run single test file
```

CI runs: install → lint → test → build (GitHub Actions, on push to main and PRs).
Pre-commit hooks run oxfmt + oxlint via Husky + lint-staged.

## Architecture

Next.js 16 App Router with React 19, TypeScript strict mode, Tailwind CSS 4, shadcn/ui (new-york style) + Radix UI primitives. Uses pnpm 11.7 and Node 24.13.

### Data flow

**Steam API → SQLite → API routes → Client hooks → UI**

- `lib/server/steam-games-sync.ts` — game ownership sync and persistence
- `lib/server/steam-achievements-sync.ts` — achievement data sync, schema management; broken games (400/403/500) are persisted with empty achievements to avoid retries
- `lib/server/steam-stats-compute.ts` — stats aggregation and sync orchestration; computes from `user_games WHERE total_count > 0`
- `lib/server/steam-store-utils.ts` — shared utilities (staleness checks, timestamps, profile management)
- `lib/server/steam-store.ts` — barrel re-export of the above modules
- `lib/server/sqlite.ts` — database schema and migrations (Node.js built-in `DatabaseSync`); tables: `steam_profile`, `games`, `user_games`, `recent_games_snapshot`, `stats_snapshot`, `hidden_games`, `allowed_users`, `game_achievements`, `user_achievements`, `pinned_games`, `extra_games`, `extra_game_achievements`, `app_catalog_meta`
- `lib/steam-api.ts` — direct Steam Web API calls (shared between server and client for types/utilities)

### API routes (`app/api/`)

- `auth/steam/` — Steam OpenID 2.0 login flow with CSRF nonce, whitelist enforcement, rate limiting; fetches level and badges at login
- `steam/games`, `steam/games/hide`, `steam/achievements`, `steam/stats`, `steam/sync`, `steam/game/[id]`, `steam/game/[id]/sync`, `steam/extras`, `steam/extras/[id]` — data endpoints; all require authenticated session via `steam_user` httpOnly cookie
- `admin/users`, `admin/pinned-games`, `admin/orphan-names` — admin-only endpoints gated by `requireAdmin()`
- `health/` — infrastructure health check (no auth)

### Client state (`hooks/`)

- `use-current-user.ts` — global user state with pub/sub listener pattern, request deduplication, and visibility-based revalidation
- `use-steam-data.ts` — `useSteamGames`, `useSteamAchievementsBatch`, `useSteamStats` with loading/refreshing states and cooldown between manual refreshes

### Auth model

Whitelist-based, multi-user ready. `STEAM_WHITELIST_IDS` (comma-separated Steam64 IDs) controls access. Empty/missing = access denied. Session stored in httpOnly cookie, re-validated on every server auth check. All user data isolated by `steam_id`. Steam level and community badges stored in the session cookie.

### Pages

- `/` — landing/login
- `/dashboard` — profile, insights (donuts), recent games
- `/games` — full library with state filters, sort, achievements toggle; supports `?filter=` and `?order=` query params
- `/game/[id]` — individual game achievement breakdown

### Design system

- Design tokens defined in `app/globals.css`: surface-1 through surface-4 (overlay layers), success/warning/danger (semantic), accent (primary action)
- Radius: rounded-lg (1.2rem), rounded-xl (1.4rem)
- Steam level badge uses official sprites from `community.fastly.steamstatic.com` with tier-based mapping (hexagons, shields, books, etc.)
- All components use design tokens — avoid hardcoded `bg-white/N` or `border-white/N`

### Key conventions

- Path alias: `@/*` maps to project root
- SQLite path resolution: `SQLITE_PATH` env → `/data/` → `.data/` fallback
- Environment variables validated with Zod lazily on first access (`lib/env.ts`)
- Structured logging via Pino (`lib/server/logger.ts`)
- `nextjs/no-img-element` oxlint rule is disabled (`.oxlintrc.json`)
- `lib/steam-api.ts` is `server-only` (logs via Pino, hashes Steam IDs before logging); client components only import _types_ from it (e.g. `SteamGame`), which TypeScript erases at compile time, so the server boundary holds. Runtime helpers a client needs (e.g. CDN image URL builders) live in the client-safe `lib/steam-image-urls.ts` instead
- Tests live in `test/` directory (Vitest + @testing-library/react + jsdom)
- All API routes and public functions have JSDoc documentation
- Schema evolution in `sqlite.ts` has three layers: `createBaseSchema` (`CREATE TABLE IF NOT EXISTS`, latest shape for fresh installs), `addColumnIfMissing`/`applyAdditiveMigrations` (additive column changes for existing databases), and the versioned `MIGRATIONS` array tracked via `PRAGMA user_version` (one-off data backfills, run once each). Add new columns to both the `CREATE TABLE` and `applyAdditiveMigrations`; append new data migrations to `MIGRATIONS` — never modify or reorder existing entries
- All changes go through issue → branch → PR → merge (never commit directly to main)
- The "tracked games" concept has been removed — stats are computed from games with achievements (total_count > 0)
