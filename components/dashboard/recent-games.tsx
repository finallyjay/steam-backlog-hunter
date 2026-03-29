"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Play } from "lucide-react"
import { GameCard } from "@/components/ui/game-card"
import { useSteamGames, useSteamAchievementsBatch } from "@/hooks/use-steam-data"
import { useMemo } from "react"
import { getSteamHeaderImageUrl } from "@/lib/steam-api"
export function RecentGames() {
  const { games, loading, error } = useSteamGames("recent")
  const recentGames = useMemo(
    () =>
      games.slice(0, 6).map((game) => ({
        id: game.appid.toString(),
        name: game.name,
        playtime: Number((game.playtime_forever / 60).toFixed(1)),
        image: getSteamHeaderImageUrl(game.appid),
        appid: game.appid,
        total_count: game.total_count ?? 0,
        unlocked_count: game.unlocked_count ?? 0,
        perfect_game: game.perfect_game ?? false,
      })),
    [games],
  )
  const appIds = useMemo(() => recentGames.map((g) => g.appid), [recentGames])
  const { achievementsMap, loading: achievementsLoading } = useSteamAchievementsBatch(appIds.length > 0 ? appIds : [])
  if (loading) {
    return (
      <Card className="border-surface-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Play className="text-accent h-5 w-5" />
            Recently Played Games
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-muted/50 flex items-center gap-4 rounded-lg p-3">
                <Skeleton className="h-16 w-16 rounded-lg" />
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
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Play className="text-accent h-5 w-5" />
            Recently Played Games
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-destructive text-sm">Failed to load recent games</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-surface-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Play className="text-accent h-5 w-5" />
          Recently Played Games
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {recentGames.length === 0 ? (
            <div className="border-surface-4 bg-surface-1 rounded-lg border px-6 py-10 text-center">
              <p className="text-muted-foreground">No recently played games.</p>
              <p className="text-muted-foreground mt-1 text-sm">
                Hit the Sync button in the header to load your Steam data.
              </p>
            </div>
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
                    serverTotal={game.total_count}
                    serverUnlocked={game.unlocked_count}
                    serverPerfect={game.perfect_game}
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
