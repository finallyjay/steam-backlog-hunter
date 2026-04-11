# Contributing

This is a personal project, but contributions are welcome. This guide captures the conventions the codebase follows so a PR lands cleanly on the first try.

## Setup

Requires **Node 24.13+** and **pnpm 10.25+**.

```bash
pnpm install
pnpm dev              # dev server at http://localhost:3000
```

You'll need a `.env.local` with at minimum `STEAM_API_KEY` and `STEAM_WHITELIST_IDS` (comma-separated Steam64 IDs). See `lib/env.ts` for the full list of validated env vars.

## Development workflow

All changes go through **issue → branch → PR → merge**. Direct commits to `main` are blocked by a branch ruleset; only repo admins have a break-glass bypass.

1. **Open an issue** describing the change (unless it's a trivial typo or one-liner).
2. **Create a branch**: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `docs/<slug>`, or `refactor/<slug>`.
3. **Push + open a PR**. The PR template will prompt you for a Summary and Test plan.
4. **CI runs** `pnpm lint` + `pnpm test` + `pnpm build` via the `quality` check. All three must pass before merging.
5. **Merge with a regular merge commit** — squash merges are not used, history is preserved on `main`.

## Code style

- **TypeScript strict mode.** No `any` without a comment explaining why.
- **Prettier + ESLint** run via Husky + lint-staged on every commit — don't fight the formatter.
- **Path alias:** `@/*` maps to the project root.
- **Default to no comments.** Only write one when the _why_ is non-obvious — hidden constraints, subtle invariants, workarounds for specific bugs.
- **Don't explain what the code does** — well-named identifiers already do that.
- **Follow existing patterns.** Check neighbouring files before inventing a new abstraction.

## Testing

- **Vitest** runs server-side code in the `node` environment and React components in `jsdom`.
- **Tests live in `test/`** and mirror the source structure loosely.
- **For SQLite integration tests**, point `SQLITE_PATH` to a temp file and call `vi.resetModules()` per test — see `test/achievements-persist.test.ts` for the pattern.
- **Run a single file** with `pnpm exec vitest run test/<file>.test.ts`.
- **All public functions and API routes** should have JSDoc documentation.

## Database changes

Since this project is pre-production, schema changes are applied by editing `createBaseSchema` in `lib/server/sqlite.ts` directly rather than adding migrations. If your change reshapes existing tables, **delete your local `.data/steam-backlog-hunter.sqlite` file** before running the branch — the app will recreate the schema on next startup and resync owned games + achievements from Steam on first login.

## Commit messages

No strict format, but prefer:

```
<type>: <short summary> (#<issue>)

<optional longer description>
```

Where type is one of `feat`, `fix`, `chore`, `docs`, `test`, `refactor`. Use `feat!` or a `BREAKING CHANGE:` footer for breaking changes.

## Architecture

See `CLAUDE.md` at the repository root for an overview of the data flow (Steam API → SQLite → API routes → client hooks → UI), the key modules, and the auth model.
