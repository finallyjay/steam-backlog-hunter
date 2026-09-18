# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Extras are classified by kind (`game`, `demo`, `dlc`, `beta`, `tool`, `software`, `other`, `unknown`) on `games.kind` from the store `type` when the store answers and from a name heuristic otherwise, with a one-off backfill for existing extras; `GET /api/steam/extras` and the extra detail expose `kind` (#354)
- Manual extras discovery: `POST /api/steam/extras/discover` runs the full pass (every game Steam remembers the account played but does not own, achievements, names, images) with a per-user in-flight guard and rate limit, `GET` reports the running state and last run, and the Extras page gets a **Discover extras** button with the last-run time and a completion summary (#352)

### Changed

- The regular library sync no longer runs the bulk extras discovery. Known extras still get their playtime refreshed from `ClientGetLastPlayedTimes`, and a game played since the previous sync is ingested on its own, but the hundreds of store lookups for everything the account ever launched, and the weekly re-sync of every extra's achievements, are left to the manual discovery action coming in #352 (#351)

## [0.11.1] - 2026-09-15

### Fixed

- Extras sync no longer drops games the account launched but never accumulated minutes
  for: rows from `ClientGetLastPlayedTimes` with `playtime_forever = 0` are kept when they
  carry a first/last play timestamp, and only launcher-only touches (no playtime, no
  timestamps) are skipped (#345).

### Changed

- `/admin/notifications` page and channel titles are larger: the page heading now matches
  the other admin pages (`text-2xl`) and the Discord/Telegram card headings use the section
  heading size (`text-lg`), so they no longer read smaller than the inputs below them (#341).
- Release discipline (#343): a `Changelog` workflow fails `feat`/`fix` PRs that do not touch
  `CHANGELOG.md` (opt out with the `skip-changelog` label), CLAUDE.md documents when to propose
  a release, and a `/release` project skill performs the mechanical steps.

## [0.11.0] - 2026-09-15

### Added

- Achievement change detection (#325). When Steam's achievement set for a game differs from
  the stored schema (post-launch additions or retired achievements), the diff is recorded per
  owning user in a new `achievement_changes` table, retired apinames are removed from
  `game_achievements`/`user_achievements` instead of lingering as permanently-locked ghosts,
  and the schema is force-refreshed in the same sync when the player payload reveals apinames
  the stored schema lacks (previously the counters could say 51/52 for up to 30 days while the
  game page still listed 51). New `GET /api/steam/achievements/changes` (`?unseen=1`) and
  `PATCH /api/steam/achievements/changes` (mark seen) endpoints expose the log for the UI.
- In-app notifications for achievement changes (#326). A toast on load summarises unseen
  changes (once per browser session for a given set), the dashboard gets an "Achievement
  changes" panel with per-row and mark-all acknowledgement, game cards show `+N new` /
  `N retired` / `Was perfect` chips (with a warning tint for games that dropped from 100%),
  `/games` gains a `new-achievements` completion filter, and the game detail page shows a
  banner with a "Got it" action and flags the newly added achievement rows.
- Scheduled achievement scan (#327). `POST /api/cron/achievements-scan`, authenticated with
  `Authorization: Bearer $CRON_SECRET` (new optional env var; endpoint answers 503 when unset),
  re-syncs achievements for every whitelisted user with a completed library sync so schema
  changes are detected without anyone opening the app. Games are visited perfect → in-progress
  → not started with an optional `maxGamesPerUser` cap, one run at a time (409 while busy), and
  the last run is recorded in `achievement_scan_meta` (readable via `GET`). A manual-only
  GitHub Actions workflow (`achievements-scan.yml`) is included as an example scheduler.
- Discord and Telegram notifications from the scheduled scan (#333), configured in a new
  `/admin/notifications` tab: enable each channel independently, store the webhook URL / bot
  token (encrypted at rest with `SESSION_SECRET`, never shown again) plus the Telegram chat id
  and optional topic/thread id, and send a test message. When a scan detects changes it posts
  a per-game summary; delivery never fails the scan and the scan response carries a
  per-channel `notifications` status.
- Explicit HTTP 429 handling in the Steam API client (`lib/steam-api.ts`): rate-limited
  requests are now retried with exponential backoff, honouring the `Retry-After` header in
  full when Valve sends one (only the exponential fallback is capped). Previously a 429 was
  swallowed as a generic failure. These retries run _before_ the existing empty-library
  guard in `runHeavyOwnedGamesSync`; that guard is unchanged, so if retries are exhausted
  `getOwnedGames` still returns `[]` and the sync preserves the previously stored library
  rather than wiping them.
- `STEAM_API_LOCALE` environment variable to override the locale (`l=`) sent to Steam.
  Defaults to `es` to preserve previous behaviour.
- Official Discord and Telegram logos on the `/admin/notifications` channel headers (#335),
  replacing the generic lucide placeholders.

### Changed

- `lib/steam-api.ts` now logs through the shared pino logger (`lib/server/logger`) instead
  of `console.error` / `console.warn`, bringing it in line with the rest of `lib/server`.
  Pure CDN URL builders (`getSteamImageUrl`, `getSteamHeaderImageUrl`,
  `getSteamPortraitImageUrl`) moved to a client-safe `lib/steam-image-urls` module so the
  Steam API client can be `server-only` without pulling the logger into the browser bundle.
- Migrated tooling to the current stack: TypeScript 7, `next` 16.3, oxlint for linting,
  pnpm 11 with overrides moved to `pnpm-workspace.yaml`, and Vitest 4. CI now reads the pnpm
  version from the `packageManager` field instead of a pinned value.
- Removed the unused `nixpacks.toml` (deploys run via Railpack) and enabled Dependabot
  version updates; refreshed the dependency lockfile (Vite 8 drops esbuild dev advisories,
  jsdom 29, lucide-react 1.x, and a large minor/patch group across the tree).

### Fixed

- Transient Steam failures (429 exhausted, 5xx, network errors) in `getPlayerAchievements`
  are no longer persisted as "broken game" with `total_count = 0`; only definitive 400/403
  responses are cached that way, so a momentary blip no longer hides a game's achievements
  for up to seven days (#292).
- A failed background refresh (tab regaining focus, `steam-data-invalidated`) no longer
  wipes already-rendered games, stats or achievements; the previous data is kept and only
  `error` is set (#293).
- 429 retries now share a 60s cumulative wait budget per request, so a chain of large
  `Retry-After` values can no longer hold a request handler open past proxy timeouts (#297).
- `useSteamHiddenGames` subscribes to the `steam-data-invalidated` event like its sibling
  hooks, so hidden games refresh after a sync (#282).

### Security

- Hardened the OpenID sign-in callback with stricter nonce and `return_to` validation to
  prevent open-redirect and replay abuse; a wrong-length nonce now redirects with
  `auth_failed` instead of crashing the route (#279).
- Session cookie is now signed with an HMAC to detect tampering (#257), and the signed
  payload carries an expiry so a stolen token is no longer valid indefinitely. Tokens
  issued before this change are rejected and users log in again once. `SESSION_SECRET`
  is now required in production (#291).
- The Steam login rate limiter derives the client IP from the trusted proxy hop instead of
  the raw `x-forwarded-for` value, so clients can no longer bypass it by spoofing the
  header (#294).
- Bumped `undici` to 7.28.0 to pick up upstream security advisories.

## [0.10.15] - 2026-05-12

### Security

- Bumped `next` to 16.2.6 and pinned `postcss >= 8.5.10` to pick up upstream security fixes.

## [0.10.14] - 2026-04-26

### Added

- Release-year and "Legacy" badges to disambiguate indistinguishable duplicate listings.

## [0.10.13] - 2026-04-26

### Fixed

- Platforms sync now requests `filters=platforms` (the `basic` filter excludes the field),
  so windows/mac/linux support is populated correctly.

[Unreleased]: https://github.com/finallyjay/steam-backlog-hunter/compare/v0.11.1...HEAD
[0.11.1]: https://github.com/finallyjay/steam-backlog-hunter/compare/v0.11.0...v0.11.1
[0.11.0]: https://github.com/finallyjay/steam-backlog-hunter/compare/v0.10.15...v0.11.0
[0.10.15]: https://github.com/finallyjay/steam-backlog-hunter/compare/v0.10.14...v0.10.15
[0.10.14]: https://github.com/finallyjay/steam-backlog-hunter/compare/v0.10.13...v0.10.14
[0.10.13]: https://github.com/finallyjay/steam-backlog-hunter/releases/tag/v0.10.13
