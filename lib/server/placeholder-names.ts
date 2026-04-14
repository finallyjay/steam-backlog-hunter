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
 *   UntitledApp            (generic placeholder)
 *   InvitedPartnerApp102   (partner-submitted entries)
 *
 * Patterns duplicated in SQL form because SQLite's GLOB syntax is a
 * subset of regex — keeps the WHERE clauses below readable and in
 * sync with this list.
 */

export const PLACEHOLDER_NAME_PATTERNS: RegExp[] = [/^ValveTestApp\d+$/, /^UntitledApp$/, /^InvitedPartnerApp\d+$/]

/**
 * SQL fragment — expand into a WHERE clause with `OR` joins. Uses
 * GLOB (case-sensitive) because Valve returns these names verbatim.
 * Keep in sync with PLACEHOLDER_NAME_PATTERNS above.
 */
export const PLACEHOLDER_NAME_SQL_MATCH =
  "(g.name GLOB 'ValveTestApp[0-9]*' OR g.name = 'UntitledApp' OR g.name GLOB 'InvitedPartnerApp[0-9]*')"

/**
 * Returns true when `name` is one of Valve's internal placeholders
 * rather than a real game title. Used to short-circuit upserts to
 * `games.name` so the hydrate chain can retry with Steam Support.
 */
export function isPlaceholderName(name: string | null | undefined): boolean {
  if (!name) return false
  return PLACEHOLDER_NAME_PATTERNS.some((rx) => rx.test(name))
}
