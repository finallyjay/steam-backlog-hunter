"use client"

import Link from "next/link"
import { useState } from "react"
import { Clock, Trophy } from "lucide-react"
import { Progress } from "@/components/ui/progress"
import type { SteamAchievementView } from "@/lib/types/steam"

interface GameCardProps {
  id: number | string
  name: string
  image: string
  playtime?: number
  achievements?: SteamAchievementView[]
  achievementsLoading?: boolean
  href?: string
}

const FALLBACK_STAGES = ["primary", "header", "legacy", "capsule", "generic", "placeholder"] as const
type FallbackStage = (typeof FALLBACK_STAGES)[number]

function getFallbackUrl(id: number | string, stage: FallbackStage): string {
  switch (stage) {
    case "header":
      return `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/header.jpg`
    case "legacy":
      return `https://steamcdn-a.akamaihd.net/steam/apps/${id}/header.jpg`
    case "capsule":
      return `https://shared.steamstatic.com/store_item_assets/steam/apps/${id}/capsule_231x87.jpg`
    case "generic":
      return "/placeholder-landscape.svg"
    case "placeholder":
      return "/placeholder-landscape.svg"
    default:
      return "/placeholder.svg"
  }
}

export function GameCard({
  id,
  name,
  image,
  playtime,
  achievements = [],
  achievementsLoading = false,
  href,
}: GameCardProps) {
  const [imageSrc, setImageSrc] = useState(image || "/placeholder-landscape.svg")
  const [fallbackIndex, setFallbackIndex] = useState(0)

  const unlocked = achievements.filter((achievement) => achievement.achieved === 1).length
  const total = achievements.length
  const percent = total > 0 ? Math.round((unlocked / total) * 100) : 0
  let progressColor = "bg-red-500"
  if (percent >= 80) progressColor = "bg-emerald-400"
  else if (percent >= 40) progressColor = "bg-amber-400"
  const isCompleted = total > 0 && unlocked === total
  const cardContent = (
    <div
      data-game-id={id}
      className={`group relative flex items-stretch gap-4 overflow-hidden rounded-[1.2rem] border border-white/10 px-4 py-4 transition-all duration-300 ${isCompleted ? "bg-emerald-500/10 hover:border-emerald-300/40" : "hover:border-accent/45 bg-white/4 hover:bg-white/6"}`}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      <img
        src={imageSrc}
        alt={`Cover art for ${name}`}
        className="h-auto min-h-[5.9rem] w-48 rounded-2xl border border-white/10 bg-slate-900/70 object-cover shadow-lg"
        onError={() => {
          const nextIndex = fallbackIndex + 1
          if (nextIndex < FALLBACK_STAGES.length) {
            setImageSrc(getFallbackUrl(id, FALLBACK_STAGES[nextIndex]))
            setFallbackIndex(nextIndex)
          }
        }}
      />
      <div className="min-w-0 flex-1">
        <h3 className="flex items-center gap-2 truncate text-base font-semibold tracking-tight">{name}</h3>
        {(playtime !== undefined || !achievementsLoading) && (
          <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {playtime !== undefined ? (
              <div className="flex items-center gap-2">
                <Clock className="h-3 w-3" />
                <span>{playtime.toFixed(1)} hours</span>
              </div>
            ) : null}

            {!achievementsLoading ? (
              total > 0 ? (
                <div className="flex items-center gap-2">
                  <Trophy className={`h-3.5 w-3.5 ${isCompleted ? "text-emerald-300" : "text-accent/90"}`} />
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
  return href ? (
    <Link href={href} className="block">
      {cardContent}
    </Link>
  ) : (
    cardContent
  )
}
