"use client"

import Link from "next/link"
import { useMemo } from "react"
import { ArrowRight, Crosshair, RefreshCw, Trophy } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { useSteamAchievementsBatch, useSteamGames } from "@/hooks/use-steam-data"
import { getSteamHeaderImageUrl } from "@/lib/steam-api"
import { buildGamesWithStats } from "@/lib/games-mapping"

export function CompletionOpportunities() {
  const {
    games,
    loading: gamesLoading,
    isRefreshing: isRefreshingGames,
    lastUpdated,
    refetch: refetchGames,
  } = useSteamGames("recent")

  const recentGames = useMemo(
    () =>
      games.slice(0, 8).map((game) => ({
        id: game.appid,
        name: game.name,
        image: getSteamHeaderImageUrl(game.appid),
        playtime: Number((game.playtime_forever / 60).toFixed(1)),
      })),
    [games],
  )

  const appIds = useMemo(() => recentGames.map((game) => game.id), [recentGames])
  const {
    achievementsMap,
    loading: achievementsLoading,
    isRefreshing: isRefreshingAchievements,
    refetch: refetchAchievements,
  } = useSteamAchievementsBatch(appIds)

  const opportunities = useMemo(() => {
    return buildGamesWithStats(recentGames, achievementsMap)
      .map((game) => {
        const unlocked = game.achievements.filter((achievement) => achievement.achieved === 1).length
        const remaining = Math.max(game.totalAchievements - unlocked, 0)

        return {
          ...game,
          unlocked,
          remaining,
        }
      })
      .filter((game) => game.totalAchievements > 0 && game.remaining > 0)
      .sort((a, b) => {
        if (a.remaining !== b.remaining) {
          return a.remaining - b.remaining
        }
        return b.percent - a.percent
      })
      .slice(0, 4)
  }, [achievementsMap, recentGames])

  const isRefreshing = isRefreshingGames || isRefreshingAchievements
  const updatedLabel = lastUpdated ? `Updated at ${lastUpdated.toLocaleTimeString()}` : "Not updated yet"

  async function handleRefresh() {
    await refetchGames()
    await refetchAchievements()
  }

  if (gamesLoading) {
    return (
      <Card className="border-white/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Crosshair className="text-accent h-5 w-5" />
            Completion Opportunities
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="rounded-[1rem] border border-white/8 bg-white/4 p-4">
                <div className="flex items-start gap-3">
                  <Skeleton className="h-14 w-14 rounded-2xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-36" />
                    <Skeleton className="h-3 w-28" />
                    <Skeleton className="h-2 w-full" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-white/10">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Crosshair className="text-accent h-5 w-5" />
            Completion Opportunities
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="gap-2 border-white/10 bg-white/5 hover:bg-white/10"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
        <p className="text-muted-foreground text-xs tracking-[0.18em] uppercase">{updatedLabel}</p>
      </CardHeader>
      <CardContent>
        {achievementsLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="rounded-[1rem] border border-white/8 bg-white/4 p-4">
                <div className="flex items-start gap-3">
                  <Skeleton className="h-14 w-14 rounded-2xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-36" />
                    <Skeleton className="h-3 w-28" />
                    <Skeleton className="h-2 w-full" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : opportunities.length === 0 ? (
          <div className="rounded-[1.1rem] border border-dashed border-white/10 bg-white/4 px-5 py-8 text-center">
            <p className="text-muted-foreground text-sm">
              No near-completion targets found in your recent games. Open a game page or sync more activity to surface
              better targets.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {opportunities.map((game) => (
              <Link
                key={game.id}
                href={`/game/${game.id}`}
                className="hover:border-accent/45 block rounded-[1.1rem] border border-white/8 bg-white/4 p-4 transition-colors hover:bg-white/6"
              >
                <div className="flex items-start gap-4">
                  <img
                    src={game.image || "/placeholder-landscape.svg"}
                    alt={game.name}
                    className="h-14 w-14 rounded-2xl border border-white/10 bg-slate-900/70 object-cover"
                  />
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-base font-semibold tracking-tight">{game.name}</h3>
                        <p className="text-muted-foreground text-sm">{game.playtime.toFixed(1)} hours played</p>
                      </div>
                      <Badge variant="secondary" className="border border-white/10 bg-white/6">
                        {game.remaining} left
                      </Badge>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground tracking-[0.16em] uppercase">Completion status</span>
                        <span className="text-foreground/90 font-medium">
                          {game.unlocked}/{game.totalAchievements} ({game.percent}%)
                        </span>
                      </div>
                      <Progress value={game.percent} indicatorClassName="bg-accent" />
                    </div>

                    <div className="text-muted-foreground flex items-center justify-between text-sm">
                      <span className="inline-flex items-center gap-2">
                        <Trophy className="text-accent h-4 w-4" />
                        Best quick-win target in recent activity
                      </span>
                      <span className="text-foreground/90 inline-flex items-center gap-1">
                        Open game
                        <ArrowRight className="h-4 w-4" />
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
