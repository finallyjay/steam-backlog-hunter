# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Explicit HTTP 429 handling in the Steam API client (`lib/steam-api.ts`): rate-limited
  requests are now retried with exponential backoff, honouring the `Retry-After` header in
  full when Valve sends one (only the exponential fallback is capped). Previously a 429 was
  swallowed as a generic failure. These retries run _before_ the existing empty-library
  guard in `runHeavyOwnedGamesSync`; that guard is unchanged, so if retries are exhausted
  `getOwnedGames` still returns `[]` and the sync preserves the previously stored library
  rather than wiping them.
- `STEAM_API_LOCALE` environment variable to override the locale (`l=`) sent to Steam.
  Defaults to `es` to preserve previous behaviour.

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

### Security

- Hardened the OpenID sign-in callback with stricter nonce and `return_to` validation to
  prevent open-redirect and replay abuse.
- Session cookie is now signed with an HMAC to detect tampering.
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

[Unreleased]: https://github.com/finallyjay/steam-backlog-hunter/compare/v0.10.15...HEAD
[0.10.15]: https://github.com/finallyjay/steam-backlog-hunter/compare/v0.10.14...v0.10.15
[0.10.14]: https://github.com/finallyjay/steam-backlog-hunter/compare/v0.10.13...v0.10.14
[0.10.13]: https://github.com/finallyjay/steam-backlog-hunter/releases/tag/v0.10.13
