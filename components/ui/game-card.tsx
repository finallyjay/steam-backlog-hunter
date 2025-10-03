"use client"

import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Clock, CheckCircle } from "lucide-react"
import { Progress } from "@/components/ui/progress"

interface GameCardProps {
  id: number | string
  name: string
  image: string
  playtime?: number
  achievements?: any[]
  achievementsLoading?: boolean
  href?: string
}

export function GameCard({ id, name, image, playtime, achievements = [], achievementsLoading = false, href }: GameCardProps) {
  const unlocked = achievements.filter((a: any) => a.achieved === 1).length
  const total = achievements.length
  const percent = total > 0 ? Math.round((unlocked / total) * 100) : 0
  let progressColor = "bg-red-500"
  if (percent >= 80) progressColor = "bg-green-600"
  else if (percent >= 40) progressColor = "bg-yellow-400"
  const isCompleted = total > 0 && unlocked === total
  const cardContent = (
    <div className={`relative flex items-center gap-4 p-3 rounded-lg border-2 border-transparent hover:border-accent transition-colors cursor-pointer ${isCompleted ? 'bg-green-100/20' : 'bg-muted/50'}`}> 
      <img
        src={image || "/placeholder.svg"}
        alt={name}
        className="w-16 h-16 rounded-lg border"
        onError={(e) => {
          e.currentTarget.src = "/generic-game-icon.png"
        }}
      />
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold truncate flex items-center gap-2">
          {name}
        </h3>
        {playtime !== undefined && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>{playtime} hours</span>
          </div>
        )}
        <div className="mt-2">
          {achievementsLoading ? (
            <span className="text-xs text-muted-foreground">Cargando logros...</span>
          ) : total > 0 ? (
            <>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs">Logros: {unlocked}/{total}</span>
              </div>
              <div>
                <Progress value={percent} indicatorClassName={progressColor} />
              </div>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">Sin logros</span>
          )}
        </div>
      </div>
    </div>
  )
  return href ? (
    <Link href={href} className="block">{cardContent}</Link>
  ) : cardContent
}
