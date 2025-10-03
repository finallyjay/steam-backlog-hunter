"use client"

import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Clock, Play } from "lucide-react"
import { GameCard } from "@/components/ui/game-card"
import { useSteamGames, useSteamAchievementsBatch } from "@/hooks/use-steam-data"
import { useMemo } from "react"
import { getSteamImageUrl } from "@/lib/steam-api"
import { Progress } from "@/components/ui/progress"

export function RecentGames() {
  const { games, loading, error } = useSteamGames("recent")
  const recentGames = useMemo(() => (
    games.slice(0, 6).map((game) => ({
      id: game.appid.toString(),
      name: game.name,
      playtime: Math.round(game.playtime_forever / 60),
      image: getSteamImageUrl(game.appid, game.img_icon_url, "icon"),
      appid: game.appid,
    }))
  ), [games])
  const appIds = useMemo(() => recentGames.map(g => g.appid), [recentGames])
  const { achievementsMap, loading: achievementsLoading, error: achievementsError } = useSteamAchievementsBatch(appIds.length > 0 ? appIds : [])

  // Renderizado
  if (loading) {
    return (
      <Card className="border-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Play className="h-5 w-5 text-accent" />
            Recently Played Games
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 p-3 rounded-lg bg-muted/50">
                <Skeleton className="w-16 h-16 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-4 w-20" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="border-2 border-destructive/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Play className="h-5 w-5 text-accent" />
            Recently Played Games
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">Failed to load recent games</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Play className="h-5 w-5 text-accent" />
          Recently Played Games
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {recentGames.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No recently played games found. Make sure your Steam profile is public.
            </p>
          ) : (
            recentGames.map((game) => {
              const achievements = achievementsMap[game.appid] || []
              return (
                <div key={game.id}>
                  <GameCard
                    id={game.id}
                    name={game.name}
                    image={game.image}
                    playtime={game.playtime}
                    href={`/game/${game.id}`}
                    achievements={achievements}
                    achievementsLoading={achievementsLoading}
                  />
                </div>
              )
            })
          )}
        </div>
      </CardContent>
    </Card>
  )
}
