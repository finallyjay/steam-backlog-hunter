import "server-only"

/**
 * Coarse classification of a Steam app, used to separate real games from
 * the demos, dedicated servers, SDKs, betas and media that pile up in the
 * extras list. Stored on `games.kind` (shared across users, like the name).
 *
 * - game      — a playable title
 * - demo      — store type "demo" or a "Demo" in the name
 * - dlc       — store type "dlc"
 * - beta      — public/closed test branches, playtests, "X Beta", "X Test"
 * - tool      — dedicated servers, SDKs, editors, launchers, redistributables
 * - software  — non-game applications (store type "application"/"config"/"tool")
 * - other     — media and store-only entries (videos, soundtracks, ads, series)
 * - unknown   — nothing to go on yet (no store answer, no name)
 */
export const APP_KINDS = ["game", "demo", "dlc", "beta", "tool", "software", "other", "unknown"] as const
export type AppKind = (typeof APP_KINDS)[number]

/**
 * Provenance of `games.kind`, mirroring `games.name_source`:
 * - store  — derived from the store appdetails `type`; stable, not recomputed
 * - name   — derived from the name heuristic; recomputed when the name changes
 * - manual — set by a user; never overwritten by any sync path
 * - NULL   — never classified
 */
export type AppKindSource = "store" | "name" | "manual"

export function isAppKind(value: unknown): value is AppKind {
  return typeof value === "string" && (APP_KINDS as readonly string[]).includes(value)
}

/**
 * Maps the `type` field of `store.steampowered.com/api/appdetails` to an
 * {@link AppKind}. Returns null for unknown / missing types so the caller
 * can fall back to the name heuristic.
 */
export function kindFromStoreType(type: string | null | undefined): AppKind | null {
  switch ((type ?? "").trim().toLowerCase()) {
    case "game":
    case "mod":
      return "game"
    case "demo":
      return "demo"
    case "dlc":
      return "dlc"
    case "tool":
    case "application":
    case "config":
      return "software"
    case "advertising":
    case "video":
    case "music":
    case "series":
    case "episode":
    case "hardware":
      return "other"
    default:
      return null
  }
}

// Ordered: the first matching rule wins. Demo before beta so "Game Demo
// Beta" reads as a demo; beta before tool so "Test Server" is a beta
// branch rather than a server binary; tool last because "Server" and
// "Tools" also appear in real game titles less often than in utilities.
const NAME_RULES: Array<{ kind: AppKind; pattern: RegExp }> = [
  { kind: "demo", pattern: /\b(demo|prologue|free trial)\b/i },
  {
    kind: "beta",
    pattern:
      /\b(beta|playtest|play test|public test|closed test|open test|test server|test build|test branch|test client|technical test|technical preview|pre-?alpha|alpha test|experimental branch)\b|\btest$/i,
  },
  {
    kind: "tool",
    pattern:
      /\b(dedicated server|server tools?|sdk|editor|authoring tools?|mod tools?|modding tools?|dev(elopment)? tools?|creation kit|development kit|dev kit|workshop tools?|benchmark|launcher|redistributables?|redist|runtime|steamworks|vr tools?|config(uration)? tools?)\b|\btools?$/i,
  },
  {
    kind: "other",
    pattern:
      /\b(soundtrack|original soundtrack|ost|artbook|art book|digital art|wallpapers?|trailer|documentary|making of|behind the scenes|bonus content|season pass|skin pack|costume pack|outfit pack)\b/i,
  },
]

/**
 * Name heuristic for apps the store cannot classify (delisted, hidden or
 * catalog-only entries). Returns null when no rule matches so the caller
 * leaves the kind untouched: a bare name is not evidence of "game".
 */
export function kindFromName(name: string | null | undefined): AppKind | null {
  const value = (name ?? "").trim()
  if (!value) return null
  for (const rule of NAME_RULES) {
    if (rule.pattern.test(value)) return rule.kind
  }
  return null
}
