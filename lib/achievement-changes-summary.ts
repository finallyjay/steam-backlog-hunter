import type { AchievementChangeSummary, AchievementChangeView } from "@/lib/types/steam"

/**
 * Rolls unseen achievement changes up per game.
 *
 * Client-safe (no server imports). Seen rows are ignored: once the user has
 * acknowledged a change it must stop driving badges and filters. Multiple
 * unseen rows for the same game (e.g. two additions a week apart) are merged.
 */
export function summarizeUnseenChanges(changes: AchievementChangeView[]): Map<number, AchievementChangeSummary> {
  const byAppId = new Map<number, AchievementChangeSummary>()
  for (const change of changes) {
    if (change.seenAt) continue
    const existing = byAppId.get(change.appId)
    if (existing) {
      existing.added += change.added.length
      existing.removed += change.removed.length
      existing.wasPerfect = existing.wasPerfect || change.wasPerfect
      existing.ids.push(change.id)
      existing.addedApinames.push(...change.added)
    } else {
      byAppId.set(change.appId, {
        appId: change.appId,
        added: change.added.length,
        removed: change.removed.length,
        wasPerfect: change.wasPerfect,
        ids: [change.id],
        addedApinames: [...change.added],
      })
    }
  }
  return byAppId
}

/** Human-readable one-liner for a change summary, e.g. "+2 new · 1 retired". */
export function describeChangeSummary(summary: Pick<AchievementChangeSummary, "added" | "removed">): string {
  const parts: string[] = []
  if (summary.added > 0) parts.push(`+${summary.added} new`)
  if (summary.removed > 0) parts.push(`${summary.removed} retired`)
  return parts.join(" · ")
}
