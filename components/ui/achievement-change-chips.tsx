import { cn } from "@/lib/utils"

const CHIP_BASE = "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium"

interface AchievementChangeChipsProps {
  added: number
  removed: number
  wasPerfect: boolean
  className?: string
}

/**
 * Pill chips summarising an achievement change: "+N new", "N retired" and
 * "Was perfect". Shared by game cards, the dashboard panel and the detail
 * page banner so the three surfaces read the same. Renders nothing when
 * there is nothing to say.
 */
export function AchievementChangeChips({ added, removed, wasPerfect, className }: AchievementChangeChipsProps) {
  if (added === 0 && removed === 0 && !wasPerfect) return null
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      {added > 0 ? (
        <span
          className={`${CHIP_BASE} bg-accent/15 text-accent border-accent/40`}
          aria-label={`${added} new achievements`}
        >
          +{added} new
        </span>
      ) : null}
      {removed > 0 ? (
        <span
          className={`${CHIP_BASE} bg-surface-3 text-foreground/60 border-surface-4`}
          aria-label={`${removed} retired achievements`}
        >
          {removed} retired
        </span>
      ) : null}
      {wasPerfect ? (
        <span
          className={`${CHIP_BASE} bg-warning/15 text-warning border-warning/40`}
          aria-label="This game was 100% complete before the change"
        >
          Was perfect
        </span>
      ) : null}
    </span>
  )
}
