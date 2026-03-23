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

function getSteamCapsuleImageUrl(id: number | string) {
  return `https://shared.steamstatic.com/store_item_assets/steam/apps/${id}/capsule_231x87.jpg`
}

export function GameCard({ id, name, image, playtime, achievements = [], achievementsLoading = false, href }: GameCardProps) {
  const [imageState, setImageState] = useState<{
    src: string
    fallbackStage: "primary" | "capsule" | "generic" | "placeholder"
    prevImage: string
  }>({ src: image || "/placeholder.svg", fallbackStage: "primary", prevImage: image })

  if (image !== imageState.prevImage) {
    setImageState({ src: image || "/placeholder.svg", fallbackStage: "primary", prevImage: image })
  }

  const { src: imageSrc, fallbackStage } = imageState

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
      className={`group relative flex items-stretch gap-4 overflow-hidden rounded-[1.2rem] border border-white/10 px-4 py-4 transition-all duration-300 ${isCompleted ? "bg-emerald-500/10 hover:border-emerald-300/40" : "bg-white/4 hover:border-accent/45 hover:bg-white/6"}`}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      <img
        src={imageSrc}
        alt={name}
        className="h-auto min-h-[5.9rem] w-48 rounded-2xl border border-white/10 bg-slate-900/70 object-cover shadow-lg"
        onError={() => {
          if (fallbackStage === "primary") {
            setImageState((s) => ({ ...s, src: getSteamCapsuleImageUrl(id), fallbackStage: "capsule" }))
            return
          }

          if (fallbackStage === "capsule") {
            setImageState((s) => ({ ...s, src: "/generic-game-icon.png", fallbackStage: "generic" }))
            return
          }

          if (fallbackStage === "generic") {
            setImageState((s) => ({ ...s, src: "/placeholder.svg", fallbackStage: "placeholder" }))
          }
        }}
      />
      <div className="flex-1 min-w-0">
        <h3 className="flex items-center gap-2 truncate text-base font-semibold tracking-tight">
          {name}
        </h3>
        {(playtime !== undefined || !achievementsLoading) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
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
                  <span className="font-medium text-foreground/90">
                    {unlocked}/{total} ({percent}%)
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Trophy className="h-3.5 w-3.5 text-muted-foreground/70" />
                  <span className="font-medium text-foreground/75">-</span>
                </div>
              )
            ) : null}
          </div>
        )}
        <div className="mt-2">
          {achievementsLoading ? (
            <span className="text-xs text-muted-foreground">Loading achievements...</span>
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
    <Link href={href} className="block">{cardContent}</Link>
  ) : cardContent
}
