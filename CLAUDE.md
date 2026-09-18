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
The `Changelog` workflow fails `feat`/`fix` PRs that do not touch `CHANGELOG.md` (label `skip-changelog` to opt out).

## Releases

Versions follow SemVer and are cut from `CHANGELOG.md` (Keep a Changelog format). Nothing here is automatic: the goal is that a release is always _proposed_ at the right moment.

- Every `feat` or `fix` PR adds an entry under `## [Unreleased]` (`### Added` / `### Changed` / `### Fixed` / `### Security`) in the same PR, referencing the issue number. Dependency-only `chore` PRs do not.
- After merging a PR, look at `Unreleased`. Propose cutting a version in the same reply when it contains any `### Added` entry, or when it only has fixes but the last tag (`git describe --tags --abbrev=0`) is more than two weeks old. Say which version and why. Never create a tag without the user asking.
- Version bump: `### Added` or behaviour-changing `### Changed` → minor; only `### Fixed` / `### Security` / dependency bumps → patch; breaking change → major (minor while on `0.x`, and say so).
- Cutting a version is the `/release` skill (`.claude/skills/release/SKILL.md`): move `Unreleased` to `## [X.Y.Z] - date`, update the compare links, bump `package.json`, PR, then tag `vX.Y.Z` on main after merge. The `Release` workflow publishes the GitHub release from that changelog section.

## Architecture

Next.js 16 App Router with React 19, TypeScript strict mode, Tailwind CSS 4, shadcn/ui (new-york style) + Radix UI primitives. Uses pnpm (pinned in `packageManager`) and Node 24 (`.nvmrc`).

### Data flow

**Steam API → SQLite → API routes → Client hooks → UI**

- `lib/server/steam-games-sync.ts` — game ownership sync and persistence
- `lib/server/steam-achievements-sync.ts` — achievement data sync, schema management; broken games (400/403/500) are persisted with empty achievements to avoid retries
- `lib/server/achievement-scan.ts` — library-wide scan for the cron endpoint: whitelisted users with a completed sync, games ordered perfect → in-progress → not started, bounded concurrency, single in-flight run, last-run record in `achievement_scan_meta`
- `lib/server/scan-notifier.ts` — posts the scan summary to Discord (webhook) and/or Telegram (Bot API, optional `message_thread_id`) for channels enabled in `notification_settings`; never throws, reports per-channel status on the scan result
- `lib/server/notification-settings.ts` — single-row `notification_settings` (enabled flags, chat/thread id) with secrets sealed by `lib/server/secret-box.ts` (AES-256-GCM keyed from `SESSION_SECRET`); masked view for the admin UI, replace-if-present secrets on save
- `lib/server/achievement-changes.ts` — records/lists achievement schema diffs (new or retired achievements) per user in `achievement_changes`; written by `persistSchema`, read via `GET/PATCH /api/steam/achievements/changes`; rows record `scan_started_at` when written inside the scheduled scan (`lib/server/scan-context.ts`, AsyncLocalStorage) so the scan summary covers only its own findings
- `lib/server/steam-stats-compute.ts` — stats aggregation and sync orchestration; computes from `user_games WHERE total_count > 0`
- `lib/server/steam-store-utils.ts` — shared utilities (staleness checks, timestamps, profile management)
- `lib/server/steam-store.ts` — barrel re-export of the above modules
- `lib/server/sqlite.ts` — database schema and migrations (Node.js built-in `DatabaseSync`); tables: `steam_profile`, `games`, `user_games`, `stats_snapshot`, `hidden_games`, `allowed_users`, `game_achievements`, `user_achievements`, `pinned_games`, `extra_games`, `extra_game_achievements`, `app_catalog_meta`, `achievement_changes`, `achievement_scan_meta`, `notification_settings`
- `lib/steam-api.ts` — direct Steam Web API calls (shared between server and client for types/utilities)

### API routes (`app/api/`)

- `auth/steam/` — Steam OpenID 2.0 login flow with CSRF nonce, whitelist enforcement, rate limiting; fetches level and badges at login
- `steam/games`, `steam/games/hide`, `steam/achievements`, `steam/achievements/changes`, `steam/stats`, `steam/sync`, `steam/game/[id]`, `steam/game/[id]/sync`, `steam/extras`, `steam/extras/[id]`, `steam/extras/[id]/sync`, `steam/extras/discover` — data endpoints; all require authenticated session via `steam_user` httpOnly cookie. `extras/discover` is the manual full extras pass (the regular sync only ingests extras played since the previous sync)
- `admin/users`, `admin/pinned-games`, `admin/orphan-names`, `admin/notifications` (+ `/test`) — admin-only endpoints gated by `requireAdmin()`
- `cron/achievements-scan` — `POST` runs the scan, `GET` reports the last run; no session, authenticated with `Authorization: Bearer $CRON_SECRET` (503 when unset). Triggered by an external scheduler (Dokploy schedule in production); `.github/workflows/achievements-scan.yml` is a manual-only example
- `health/` — infrastructure health check (no auth)

### Client state (`hooks/`)

- `use-current-user.ts` — global user state with pub/sub listener pattern, request deduplication, and visibility-based revalidation
- `use-steam-data.ts` — `useSteamGames`, `useSteamAchievementsBatch`, `useSteamStats` with loading/refreshing states and cooldown between manual refreshes
- `use-achievement-changes.ts` — module-level shared store (`useSyncExternalStore`) for `achievement_changes`; one fetch per session, refetch on `steam-data-invalidated`, optimistic `markSeen` with rollback. Consumed by the layout toast notifier, the dashboard panel, the `/games` `new-achievements` filter and the `/game/[id]` banner

### Auth model

Whitelist-based, multi-user ready. `STEAM_WHITELIST_IDS` (comma-separated Steam64 IDs) controls access. Empty/missing = access denied. Session stored in httpOnly cookie, re-validated on every server auth check. All user data isolated by `steam_id`. Steam level and community badges stored in the session cookie.

### Pages

- `/` — landing/login
- `/dashboard` — profile, insights (donuts), recent games
- `/games` — full library with state filters, sort, achievements toggle; supports `?filter=` (including `new-achievements`) and `?order=` query params
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
- The `nextjs-agent-rules` block at the end of this file is managed by `next dev` (Next.js 16.3+): it is committed on purpose so it does not reappear as an uncommitted change on every dev start. When a Next.js upgrade rewrites it, commit the update in the same PR
- The "tracked games" concept has been removed — stats are computed from games with achievements (total_count > 0)

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
