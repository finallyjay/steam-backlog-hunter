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

/**
 * Up to 2 decimal places, trailing zeros stripped. JS's Number→string
 * conversion drops trailing zeros for free, so `82.0 → "82"`, `82.3 → "82.3"`,
 * `82.35 → "82.35"`. Round first to avoid showing floating-point noise like
 * "82.29999999".
 */
function formatPercent(percent: number): string {
  return `${Math.round(percent * 100) / 100}%`
}

/**
 * Rarity tiers with four visually distinct hues so a glance reads the tier
 * before the number. The dark theme already leans cyan for both `accent` and
 * `muted-foreground`, so we route ultra-rare to `danger` (magenta) and common
 * to a plain chroma-less gray (`text-foreground/60`) to avoid two blue-ish
 * badges sitting next to each other.
 *
 *   <5%   — ultra rare   → danger (magenta/pink)
 *   <15%  — very rare    → warning (amber)
 *   <40%  — uncommon     → success (green)
 *   ≥40%  — common       → neutral gray
 */
function rarityBadgeClass(percent: number): string {
  if (percent < 5) return "bg-danger/15 text-danger border-danger/40"
  if (percent < 15) return "bg-warning/15 text-warning border-warning/40"
  if (percent < 40) return "bg-success/15 text-success border-success/40"
  return "bg-surface-3 text-foreground/60 border-surface-4"
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
 * button; the user can toggle reveal per-row, matching Steam's own UX. The
 * rarity badge is always shown when globalPercent is known — rarity is
 * metadata about the game, not the hidden achievement's identity.
 */
export function AchievementRow({ achievement: ach }: AchievementRowProps) {
  const [revealed, setRevealed] = useState(false)
  const isUnlocked = ach.achieved === 1
  const showFullText = isUnlocked || ach.hidden !== 1 || revealed

  const timestamp = isUnlocked && ach.unlocktime ? formatUnlockTimestamp(ach.unlocktime) : null

  const rarityBadge =
    ach.globalPercent != null ? (
      <span
        className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium ${rarityBadgeClass(ach.globalPercent)}`}
      >
        {formatPercent(ach.globalPercent)}
      </span>
    ) : null

  return (
    <li
      className={`border-surface-4 flex items-center gap-4 rounded-lg border p-4 transition-colors ${
        isUnlocked ? "bg-card/80" : "bg-card/60 opacity-90"
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
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-semibold">{ach.displayName}</span>
              {rarityBadge}
            </div>
            {ach.description && <div className="text-muted-foreground text-sm">{ach.description}</div>}
          </>
        ) : (
          <>
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-muted-foreground truncate font-semibold italic">Logro oculto</span>
              {rarityBadge}
            </div>
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
      {timestamp && (
        <div className="text-muted-foreground shrink-0 space-y-0.5 text-right text-xs">
          <div>{timestamp.date}</div>
          <div>{timestamp.time}</div>
        </div>
      )}
    </li>
  )
}
