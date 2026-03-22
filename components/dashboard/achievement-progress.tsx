"use client"

import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Trophy, RefreshCw, ArrowDownWideNarrow } from "lucide-react"
import { useSteamGames, useSteamAchievements } from "@/hooks/use-steam-data"
import type { SteamAchievementView } from "@/lib/types/steam"

function sortByUnlockDateDesc(a: SteamAchievementView, b: SteamAchievementView) {
  if (!a.unlocktime && !b.unlocktime) return 0
  if (!a.unlocktime) return 1
  if (!b.unlocktime) return -1
  return b.unlocktime - a.unlocktime
}

export function AchievementProgress() {
  const { games, loading: gamesLoading } = useSteamGames("recent")
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null)
  const defaultGameId = useMemo(
    () => games.find((game) => game.has_community_visible_stats)?.appid ?? null,
    [games],
  )
  const activeGameId = selectedGameId ?? defaultGameId
  const {
    achievements,
    loading: achievementsLoading,
    isRefreshing: isRefreshingAchievements,
    lastUpdated,
    refetch,
  } = useSteamAchievements(activeGameId)
  const updatedLabel = lastUpdated ? `Updated at ${lastUpdated.toLocaleTimeString()}` : "Not updated yet"

  if (gamesLoading) {
    return (
      <Card className="border-white/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Trophy className="h-5 w-5 text-accent" />
            Achievement Progress
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="p-4 rounded-lg bg-muted/50">
                <div className="flex items-start gap-3">
                  <Skeleton className="w-12 h-12 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-48" />
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

  const gamesWithStats = games.filter((game) => game.has_community_visible_stats)

  // Filter only locked achievements and sort by unlock date desc
  const lockedAchievements = Array.isArray(achievements)
    ? achievements.filter((achievement) => !achievement.achieved).sort(sortByUnlockDateDesc)
    : []

  return (
    <Card className="border-white/10">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Trophy className="h-5 w-5 text-accent" />
            Achievement Progress
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            disabled={!activeGameId || isRefreshingAchievements}
            className="gap-2 border-white/10 bg-white/5 hover:bg-white/10"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshingAchievements ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          {updatedLabel}
        </p>
      </CardHeader>
      <CardContent>
        {gamesWithStats.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No games with public achievement stats found. Make sure your Steam profile and game details are public.
          </p>
        ) : (
          <div className="space-y-4">
            {/* Game Selection */}
            <div className="flex flex-wrap gap-2">
              {gamesWithStats.slice(0, 5).map((game) => (
                <Button
                  key={game.appid}
                  variant={activeGameId === game.appid ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedGameId(game.appid)}
                  className="text-xs"
                >
                  {game.name}
                </Button>
              ))}
            </div>

            {/* Achievement Display */}
            {activeGameId && (
              <div className="space-y-4">
                {achievementsLoading ? (
                  <div className="space-y-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="p-4 rounded-lg bg-muted/50">
                        <div className="flex items-start gap-3">
                          <Skeleton className="w-12 h-12 rounded-lg" />
                          <div className="flex-1 space-y-2">
                            <Skeleton className="h-4 w-32" />
                            <Skeleton className="h-3 w-48" />
                            <Skeleton className="h-2 w-full" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : lockedAchievements.length > 0 ? (
                  <>
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold">
                        {gamesWithStats.find((game) => game.appid === activeGameId)?.name || "Game"}
                      </h3>
                      <Badge variant="secondary">
                        {lockedAchievements.length} pending
                      </Badge>
                    </div>

                    <div className="space-y-3">
                      {lockedAchievements.slice(0, 5).map((achievement, index: number) => (
                        <div key={index} className="rounded-[1rem] border border-white/8 bg-white/4 p-3 transition-colors hover:bg-white/6">
                          <div className="flex items-start gap-3">
                            <img
                              src={achievement.icongray || achievement.icon || "/placeholder.svg"}
                              alt={achievement.displayName}
                              className="h-12 w-12 rounded-xl border border-white/10 grayscale"
                              onError={(e) => {
                                e.currentTarget.src = "/achievement-icon.png"
                              }}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <h4 className="font-semibold truncate text-sm">
                                  {achievement.displayName || achievement.apiname}
                                </h4>
                                <Badge variant="secondary" className="text-xs">
                                  Pending
                                </Badge>
                              </div>
                              <p className="text-xs text-muted-foreground mb-2">
                                {achievement.description || "No description available"}
                              </p>
                              {achievement.unlocktime && (
                                <p className="text-xs text-muted-foreground flex items-center gap-1">
                                  <ArrowDownWideNarrow className="w-4 h-4" />
                                  {new Date(achievement.unlocktime * 1000).toLocaleDateString()}
                                </p>
                              )}
                              <Progress value={0} className="mt-2 h-1" />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {lockedAchievements.length > 5 && (
                      <p className="text-xs text-muted-foreground text-center">
                        Showing 5 of {lockedAchievements.length} pending achievements
                      </p>
                    )}
                  </>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-sm text-muted-foreground mb-2">You have no pending achievements in this game!</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void refetch()}
                      className="gap-2"
                    >
                      <RefreshCw className={`h-4 w-4 ${isRefreshingAchievements ? "animate-spin" : ""}`} />
                      Retry
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
