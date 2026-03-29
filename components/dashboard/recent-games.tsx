"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Play, RefreshCw } from "lucide-react"
import { GameCard } from "@/components/ui/game-card"
import { useSteamGames, useSteamAchievementsBatch } from "@/hooks/use-steam-data"
import { useMemo } from "react"
import { getSteamHeaderImageUrl } from "@/lib/steam-api"
import { Button } from "@/components/ui/button"

export function RecentGames() {
  const {
    games,
    loading,
    isRefreshing: isRefreshingGames,
    lastUpdated: gamesLastUpdated,
    error,
    refetch: refetchGames,
  } = useSteamGames("recent")
  const recentGames = useMemo(
    () =>
      games.slice(0, 6).map((game) => ({
        id: game.appid.toString(),
        name: game.name,
        playtime: Number((game.playtime_forever / 60).toFixed(1)),
        image: getSteamHeaderImageUrl(game.appid),
        appid: game.appid,
      })),
    [games],
  )
  const appIds = useMemo(() => recentGames.map((g) => g.appid), [recentGames])
  const {
    achievementsMap,
    loading: achievementsLoading,
    isRefreshing: isRefreshingAchievements,
    refetch: refetchAchievements,
  } = useSteamAchievementsBatch(appIds.length > 0 ? appIds : [])
  const isRefreshing = isRefreshingGames || isRefreshingAchievements
  const updatedLabel = gamesLastUpdated ? `Updated at ${gamesLastUpdated.toLocaleTimeString()}` : "Not updated yet"

  async function handleRefresh() {
    await refetchGames()
    await refetchAchievements()
  }

  // Renderizado
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
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Play className="text-accent h-5 w-5" />
            Recently Played Games
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="border-surface-4 bg-surface-1 hover:bg-surface-4 gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
        <p className="text-muted-foreground text-xs tracking-[0.18em] uppercase">{updatedLabel}</p>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {recentGames.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
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
