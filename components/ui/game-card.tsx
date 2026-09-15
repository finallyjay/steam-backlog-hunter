"use client"

import Link from "next/link"
import { Apple, Archive, Clock, EyeOff, Monitor, Terminal, Trophy } from "lucide-react"
import { Card, CardContent, CardFooter } from "@/components/ui/card"
import { GameImage } from "@/components/ui/game-image"
import { Progress } from "@/components/ui/progress"
import { AchievementChangeChips } from "@/components/ui/achievement-change-chips"
import { cn, formatPlaytime } from "@/lib/utils"
import type { AchievementChangeSummary, SteamAchievementView } from "@/lib/types/steam"

interface GameCardProps {
  id: number | string
  name: string
  /** Landscape header image (460×215). Used on sm+ viewports. */
  image: string
  /**
   * Optional portrait capsule (600×900, 2:3). Used on mobile (<640 px) via
   * a `<picture>` element so the thumbnail takes less horizontal room and
   * looks more like Steam's own mobile library. Falls back to the
   * landscape image (cropped) when null/undefined.
   */
  imagePortrait?: string | null
  playtime?: number
  achievements?: SteamAchievementView[]
  achievementsLoading?: boolean
  href?: string
  serverTotal?: number
  serverUnlocked?: number
  serverPerfect?: boolean
  onHide?: (appId: number) => void
  actions?: React.ReactNode
  /**
   * Platform availability badges. Only rendered when set — the library view
   * passes this only for games whose name collides with another in the same
   * library, so the typical Windows-only card stays visually clean.
   */
  platforms?: { windows: boolean; mac: boolean; linux: boolean } | null
  /**
   * Release year, surfaced as a secondary disambiguator next to the platform
   * icons when name collides. `null` on a colliding row signals a stripped
   * legacy listing (Steam returns an empty release_date for some unified
   * editions, e.g. GTA III appid 12230) and renders an "Archive" badge.
   */
  releaseYear?: number | null
  /**
   * Unseen achievement changes for this game (new or retired achievements
   * detected since the user last acknowledged them). Renders "+N new" /
   * "N retired" / "Was perfect" chips next to the title, and tints the card
   * with the warning colour when a formerly perfect game is no longer 100%.
   */
  changeSummary?: Pick<AchievementChangeSummary, "added" | "removed" | "wasPerfect"> | null
}

// Responsive thumbnail container: portrait (2:3 Steam library capsule)
// on mobile, landscape (Steam 460×215 header) on sm+. Two <GameImage>
// instances live inside, one hidden per breakpoint, each with its own
// orientation-specific fallback chain.
const GAME_CARD_THUMB_CLASSES =
  "border-surface-4 relative aspect-[2/3] w-20 shrink-0 overflow-hidden rounded-2xl border bg-slate-900/70 shadow-lg sm:aspect-[460/215] sm:w-32 md:w-48"

export function GameCard({
  id,
  name,
  image,
  imagePortrait,
  playtime,
  achievements = [],
  achievementsLoading = false,
  href,
  serverTotal = 0,
  serverUnlocked = 0,
  serverPerfect = false,
  onHide,
  actions,
  platforms,
  releaseYear,
  changeSummary,
}: GameCardProps) {
  // Use detailed achievements if available, fall back to server-side counts
  const hasDetail = achievements.length > 0
  const unlocked = hasDetail ? achievements.filter((a) => a.achieved === 1).length : serverUnlocked
  const total = hasDetail ? achievements.length : serverTotal
  const percent = total > 0 ? Math.round((unlocked / total) * 100) : 0
  let progressColor = "bg-danger"
  if (percent >= 80) progressColor = "bg-success"
  else if (percent >= 40) progressColor = "bg-warning"
  const isCompleted = serverPerfect || (total > 0 && unlocked === total)
  const hasChanges = Boolean(changeSummary && (changeSummary.added > 0 || changeSummary.removed > 0))
  const lostPerfect = Boolean(changeSummary?.wasPerfect) && !isCompleted
  const mainContent = (
    <div className="flex items-stretch gap-4">
      <div className={GAME_CARD_THUMB_CLASSES}>
        <GameImage
          appId={id}
          src={imagePortrait}
          orientation="portrait"
          alt={`Cover art for ${name}`}
          className="block h-full w-full object-cover sm:hidden"
        />
        <GameImage
          appId={id}
          src={image}
          orientation="landscape"
          alt={`Cover art for ${name}`}
          className="hidden h-full w-full object-cover sm:block"
        />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="flex min-w-0 items-center gap-2 text-lg font-semibold tracking-tight lg:text-xl">
          <span className="truncate">{name}</span>
          {hasChanges && changeSummary ? (
            <AchievementChangeChips
              added={changeSummary.added}
              removed={changeSummary.removed}
              wasPerfect={lostPerfect}
              className="shrink-0"
            />
          ) : null}
        </h3>
        {(playtime !== undefined || !achievementsLoading) && (
          <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {playtime !== undefined ? (
              <div className="flex items-center gap-2">
                <Clock className="h-3 w-3" />
                <span>{formatPlaytime(playtime)}</span>
              </div>
            ) : null}

            {!achievementsLoading ? (
              total > 0 ? (
                <div className="flex items-center gap-2">
                  <Trophy className={`h-3.5 w-3.5 ${isCompleted ? "text-success" : "text-accent/90"}`} />
                  <span className="text-foreground/90 font-medium">
                    {unlocked}/{total} ({percent}%)
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Trophy className="text-muted-foreground/70 h-3.5 w-3.5" />
                  <span className="text-foreground/75 font-medium">-</span>
                </div>
              )
            ) : null}

            {platforms ? (
              <div className="text-muted-foreground flex items-center gap-1.5" aria-label="Available platforms">
                {platforms.windows ? <Monitor className="h-3.5 w-3.5" aria-label="Windows" /> : null}
                {platforms.mac ? <Apple className="h-3.5 w-3.5" aria-label="macOS" /> : null}
                {platforms.linux ? <Terminal className="h-3.5 w-3.5" aria-label="Linux" /> : null}
                {releaseYear ? (
                  <span className="text-[0.7rem] font-medium tabular-nums" aria-label={`Released ${releaseYear}`}>
                    {releaseYear}
                  </span>
                ) : releaseYear === null ? (
                  <span
                    className="flex items-center gap-1 text-[0.7rem] font-medium"
                    aria-label="Legacy listing (no store metadata)"
                    title="Legacy edition — store metadata stripped by Steam"
                  >
                    <Archive className="h-3 w-3" aria-hidden="true" />
                    Legacy
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
        <div className="mt-2">
          {achievementsLoading ? (
            <span className="text-muted-foreground text-xs">Loading achievements...</span>
          ) : total > 0 ? (
            <Progress value={percent} indicatorClassName={progressColor} />
          ) : (
            <div className="h-2" />
          )}
        </div>
      </div>
    </div>
  )

  return (
    <Card
      data-game-id={id}
      className={cn(
        "group relative gap-0 overflow-hidden rounded-lg px-4 py-4 shadow-none backdrop-blur-none transition-all duration-300 hover:-translate-y-0.5",
        isCompleted
          ? "bg-success/10 hover:border-success/40"
          : lostPerfect
            ? "bg-warning/10 hover:border-warning/40"
            : "bg-surface-1 hover:border-accent/45 hover:bg-surface-2",
      )}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      {onHide && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onHide(Number(id))
          }}
          className="bg-background/80 text-muted-foreground hover:text-foreground pointer-events-none absolute top-2 right-2 z-10 rounded-md p-1.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
          aria-label={`Hide ${name}`}
        >
          <EyeOff className="h-3.5 w-3.5" />
        </button>
      )}
      {href ? (
        <Link href={href} className="block">
          <CardContent className="px-0">{mainContent}</CardContent>
        </Link>
      ) : (
        <CardContent className="px-0">{mainContent}</CardContent>
      )}
      {actions && <CardFooter className="border-surface-4/50 mt-3 gap-2 border-t px-0 pt-3">{actions}</CardFooter>}
    </Card>
  )
}
