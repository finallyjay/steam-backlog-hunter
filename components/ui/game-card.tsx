"use client"

import Link from "next/link"
import { Clock } from "lucide-react"
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

export function GameCard({ id, name, image, playtime, achievements = [], achievementsLoading = false, href }: GameCardProps) {
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
      className={`group relative flex items-center gap-4 overflow-hidden rounded-[1.2rem] border border-white/10 px-4 py-4 transition-all duration-300 ${isCompleted ? "bg-emerald-500/10 hover:border-emerald-300/40" : "bg-white/4 hover:border-accent/45 hover:bg-white/6"}`}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      <img
        src={image || "/placeholder.svg"}
        alt={name}
        className="h-16 w-16 rounded-2xl border border-white/10 bg-slate-900/70 object-cover shadow-lg"
        onError={(e) => {
          e.currentTarget.src = "/generic-game-icon.png"
        }}
      />
      <div className="flex-1 min-w-0">
        <h3 className="flex items-center gap-2 truncate text-base font-semibold tracking-tight">
          {name}
        </h3>
        {playtime !== undefined && (
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>{playtime.toFixed(1)} hours</span>
          </div>
        )}
        <div className="mt-3">
          {achievementsLoading ? (
            <span className="text-xs text-muted-foreground">Loading achievements...</span>
          ) : total > 0 ? (
            <>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Achievement status</span>
                <span className="text-sm font-medium text-foreground/90">Achievements: {unlocked}/{total} ({percent}%)</span>
              </div>
              <div>
                <Progress value={percent} indicatorClassName={progressColor} />
              </div>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">No achievements</span>
          )}
        </div>
      </div>
    </div>
  )
  return href ? (
    <Link href={href} className="block">{cardContent}</Link>
  ) : cardContent
}
