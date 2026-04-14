import "server-only"

/**
 * Internal placeholder names Valve's Web API returns for apps whose
 * public title hasn't been set (or has been withheld). These show up
 * via GetPlayerAchievements.gameName and GetSchemaForGame.gameName
 * most commonly for unowned-but-played games (family share, refunded,
 * delisted) where Valve serves a developer-time internal name instead
 * of the customer-facing title. Steam Support's "Help with game"
 * wizard knows the real name for these, so our hydrate chain can
 * resolve them — but only if we actually flag them as placeholders
 * and skip writing them to `games.name`.
 *
 * Observed examples in the wild:
 *   ValveTestApp43110      (Metro 2033)
 *   UntitledApp / UntitledApp0   (generic placeholder, bare or numbered)
 *   GreenlightApp0         (Greenlight-era submission)
 *   InvitedPartnerApp102   (partner-submitted entries)
 *
 * Each prefix allows either the exact base text or the base followed
 * by any run of digits (`\d*` in regex, `[0-9]*` in SQLite GLOB).
 * Non-digit suffixes are rejected so we don't misfire on real titles
 * that happen to start with one of the prefixes (e.g. a hypothetical
 * "GreenlightApplication").
 *
 * Patterns duplicated in SQL form because SQLite's GLOB syntax is a
 * subset of regex — keeps the WHERE clauses below readable and in
 * sync with this list.
 */

const PLACEHOLDER_PREFIXES = ["ValveTestApp", "UntitledApp", "GreenlightApp", "InvitedPartnerApp"] as const

export const PLACEHOLDER_NAME_PATTERNS: RegExp[] = PLACEHOLDER_PREFIXES.map((prefix) => new RegExp(`^${prefix}\\d*$`))

/**
 * SQL fragment — drop into a WHERE clause as a prefixed OR group.
 * Matches each prefix either exactly or followed by a run of digits.
 * Kept in one string so every caller uses the same pattern set.
 */
export const PLACEHOLDER_NAME_SQL_MATCH =
  "(" + PLACEHOLDER_PREFIXES.map((p) => `g.name = '${p}' OR g.name GLOB '${p}[0-9]*'`).join(" OR ") + ")"

/**
 * Same fragment as {@link PLACEHOLDER_NAME_SQL_MATCH} but without the
 * `g.` alias — for queries that reference `games` unqualified
 * (e.g. migration UPDATEs that don't use a JOIN).
 */
export const PLACEHOLDER_NAME_SQL_MATCH_BARE =
  "(" + PLACEHOLDER_PREFIXES.map((p) => `name = '${p}' OR name GLOB '${p}[0-9]*'`).join(" OR ") + ")"

/**
 * Returns true when `name` is one of Valve's internal placeholders
 * rather than a real game title. Used to short-circuit upserts to
 * `games.name` so the hydrate chain can retry with Steam Support.
 */
export function isPlaceholderName(name: string | null | undefined): boolean {
  if (!name) return false
  return PLACEHOLDER_NAME_PATTERNS.some((rx) => rx.test(name))
}
