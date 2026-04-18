"use client"

import { useState } from "react"

import type { SteamAchievementView } from "@/lib/types/steam"

/**
 * Formats a unix timestamp (in seconds) as `dd-mm-yyyy` / `HH:mm` 24h in the
 * user's local timezone, ready to render on two lines.
 */
function formatUnlockTimestamp(unixSeconds: number): { date: string; time: string } {
  const d = new Date(unixSeconds * 1000)
  const pad = (n: number) => String(n).padStart(2, "0")
  return {
    date: `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}

/** Formats the global-% label with 1 decimal under 10% (where rarity differences matter). */
function formatGlobalPercent(percent: number): string {
  const value = percent < 10 ? percent.toFixed(1) : Math.round(percent).toString()
  return `${value}% global`
}

interface AchievementRowProps {
  achievement: SteamAchievementView
}

/**
 * One row in the achievement list on `/game/[id]` and `/extras/[id]`. Shared
 * between both pages so the hidden-reveal interaction, timestamp formatting
 * and global rarity display stay consistent.
 *
 * Hidden behaviour: unlocked achievements always show their full name +
 * description regardless of the `hidden` flag (the game dev only wants them
 * hidden until earned). Locked + hidden rows gate the text behind a "Revelar"
 * button; the user can toggle reveal per-row, matching Steam's own UX.
 */
export function AchievementRow({ achievement: ach }: AchievementRowProps) {
  const [revealed, setRevealed] = useState(false)
  const isUnlocked = ach.achieved === 1
  const showFullText = isUnlocked || ach.hidden !== 1 || revealed

  const timestamp = isUnlocked && ach.unlocktime ? formatUnlockTimestamp(ach.unlocktime) : null

  return (
    <li
      className={`border-surface-4 flex items-center gap-4 rounded-lg border p-4 transition-colors ${
        isUnlocked ? "bg-surface-1" : "bg-white/2 opacity-70"
      }`}
    >
      <img
        src={(isUnlocked ? ach.icon : ach.icongray) || ach.icon || "/placeholder-icon.svg"}
        alt={`Icon for ${ach.displayName} achievement`}
        className="h-12 w-12 rounded-lg"
      />
      <div className="min-w-0 flex-1">
        {showFullText ? (
          <>
            <div className="truncate font-semibold">{ach.displayName}</div>
            {ach.description && <div className="text-muted-foreground text-sm">{ach.description}</div>}
          </>
        ) : (
          <>
            <div className="text-muted-foreground truncate font-semibold italic">Logro oculto</div>
            <button
              type="button"
              onClick={() => setRevealed(true)}
              className="text-accent text-sm underline-offset-2 hover:underline"
            >
              Revelar
            </button>
          </>
        )}
      </div>
      {(timestamp || ach.globalPercent != null) && (
        <div className="text-muted-foreground shrink-0 space-y-0.5 text-right text-xs">
          {timestamp && (
            <>
              <div>{timestamp.date}</div>
              <div>{timestamp.time}</div>
            </>
          )}
          {ach.globalPercent != null && (
            <div className={timestamp ? "pt-1" : ""}>{formatGlobalPercent(ach.globalPercent)}</div>
          )}
        </div>
      )}
    </li>
  )
}
