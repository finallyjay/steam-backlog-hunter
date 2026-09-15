---
name: release
description: Cut a new version of steam-backlog-hunter. Reads the Unreleased section of CHANGELOG.md, proposes the next SemVer version, moves the section, bumps package.json, opens the release PR and, once merged, pushes the tag that triggers the Release workflow. Use when the user asks to release, cut a version, tag, or publish.
user-invocable: true
---

# Release

Mechanical steps for cutting a version. The rules on _when_ to propose a release live in
CLAUDE.md ("Releases"); this skill only executes.

## 1. Inspect

```bash
test -z "$(git status --porcelain)" || { echo "working tree is dirty"; exit 1; }
git checkout main && git pull -q origin main
git describe --tags --abbrev=0                 # last tag
awk '/^## \[Unreleased\]/{f=1;next} /^## \[/{exit} f' CHANGELOG.md   # pending entries
```

Stop and tell the user if the working tree is dirty (before touching branches) or if
`Unreleased` is empty.

## 2. Propose the version

Start from the last tag and apply the highest rule that matches the `Unreleased` content:

- Breaking change noted → **major** (while on `0.x`, use **minor** and say so).
- Any `### Added` entry, or a `### Changed` entry that alters behaviour → **minor**.
- Only `### Fixed` / `### Security` / dependency bumps → **patch**.

Present the version and a one-line summary of what it contains, then wait for confirmation
unless the user already gave the version.

## 3. Release PR

On a branch `release/vX.Y.Z`:

1. In `CHANGELOG.md`, replace `## [Unreleased]` with `## [Unreleased]\n\n## [X.Y.Z] - YYYY-MM-DD`
   (today's date, ISO). Move nothing else; the entries already sit under the new heading.
2. In the link footer, point `[Unreleased]` at `compare/vX.Y.Z...HEAD` and add
   `[X.Y.Z]: https://github.com/finallyjay/steam-backlog-hunter/compare/v<prev>...vX.Y.Z`.
3. Set `"version": "X.Y.Z"` in `package.json`.
4. `pnpm format`, commit as `chore(release): vX.Y.Z`, push, open the PR with the changelog
   section as its body. Follow the repo flow: issue first, PR closes it.

## 4. Tag after merge

Only after the PR is squash-merged and the user has confirmed:

```bash
test -z "$(git status --porcelain)" || { echo "working tree is dirty"; exit 1; }
git checkout main && git pull -q origin main
test "$(node -p "require('./package.json').version")" = "X.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z

# Wait for the Release run created by this tag push (not just the latest run).
tag_commit="$(git rev-parse "vX.Y.Z^{commit}")"
until run_id="$(gh run list --workflow=release.yml --commit="$tag_commit" --limit 1 --json databaseId --jq '.[0].databaseId')" &&
      [ -n "$run_id" ]; do
  sleep 5
done
gh run watch "$run_id" --exit-status
gh release view vX.Y.Z --json url --jq .url
```

The `Release` workflow verifies the tag against `package.json`, extracts the `## [X.Y.Z]`
section and publishes the GitHub release. If it fails, fix the cause and re-run it rather than
creating the release by hand, so the workflow stays trustworthy.
