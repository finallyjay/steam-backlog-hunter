# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev              # Start dev server (localhost:3000)
pnpm build            # Production build (standalone output)
pnpm lint             # ESLint + typecheck (runs both)
pnpm typecheck        # next typegen + tsc --noEmit
pnpm test             # Vitest run (all tests)
pnpm exec vitest run test/<file>.test.ts  # Run single test file
```

CI runs: install → lint → test → build (GitHub Actions, on push to main and PRs).

## Architecture

Next.js 16 App Router with React 19, TypeScript strict mode, Tailwind CSS 4, shadcn/ui (new-york style) + Radix UI primitives. Uses pnpm 10.25 and Node 24.13.

### Data flow

**Steam API → Cache (optional Redis) → SQLite → API routes → Client hooks → UI**

- `lib/server/steam-store.ts` — core data logic: fetches from Steam API, persists to SQLite, manages staleness thresholds
- `lib/server/sqlite.ts` — database schema (auto-initialized via Node.js built-in `DatabaseSync`); tables: `steam_profile`, `games`, `user_games`, `recent_games_snapshot`, `stats_snapshot`, `tracked_games`
- `lib/steam-api.ts` — direct Steam Web API calls

### API routes (`app/api/`)

- `auth/steam/` — Steam OpenID 2.0 login flow with whitelist enforcement (`STEAM_WHITELIST_IDS`)
- `steam/games`, `steam/achievements`, `steam/stats`, `steam/sync`, `steam/game/[id]` — data endpoints; all require authenticated session via `steam_user` httpOnly cookie

### Client state (`hooks/`)

- `use-current-user.ts` — global user state with pub/sub listener pattern and request deduplication
- `use-steam-data.ts` — `useSteamGames`, `useSteamAchievementsBatch`, `useSteamStats` with loading/refreshing states and cooldown between manual refreshes

### Auth model

Single-user/whitelist-based. `STEAM_WHITELIST_IDS` (comma-separated Steam64 IDs) controls access. Empty/missing = access denied. Session stored in httpOnly cookie, re-validated on every server auth check.

### Pages

- `/` — landing/login
- `/dashboard` — stats overview with tabs (Overview, Recent, Library, Completion)
- `/games` — full library with filter bar (scope, bucket, state query params)
- `/game/[id]` — individual game achievement breakdown

### Key conventions

- Path alias: `@/*` maps to project root
- SQLite path resolution: `SQLITE_PATH` env → `/data/` → `.data/` fallback
- `@next/next/no-img-element` ESLint rule is disabled
- `typescript.ignoreBuildErrors: true` in next.config.mjs
- Tests live in `test/` directory (Vitest + @testing-library/react + jsdom)
