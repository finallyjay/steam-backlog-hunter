/**
 * Client-safe helpers for the app kind stored on `games.kind`
 * (see lib/server/app-kind.ts for the classifier).
 */

export const APP_KIND_LABELS: Record<string, string> = {
  game: "Game",
  demo: "Demo",
  dlc: "DLC",
  beta: "Beta",
  tool: "Tool",
  software: "Software",
  other: "Other",
  unknown: "Unknown",
}

/** Human label for a kind; falls back to the raw value for forward compatibility. */
export function appKindLabel(kind: string | null | undefined): string {
  if (!kind) return APP_KIND_LABELS.unknown
  return APP_KIND_LABELS[kind] ?? kind
}

/**
 * Kinds shown by default on the extras page: real games plus anything we
 * could not classify (hiding "unknown" would silently bury real games
 * that only lack a store page).
 */
export function isGameLikeKind(kind: string | null | undefined): boolean {
  return !kind || kind === "game" || kind === "unknown"
}

/** Filters a list by kind unless `showAll` is set. */
export function filterByKind<T extends { kind?: string | null }>(items: T[], showAll: boolean): T[] {
  if (showAll) return items
  return items.filter((item) => isGameLikeKind(item.kind))
}
