"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Trophy, Star, RefreshCw, ArrowDownWideNarrow } from "lucide-react"
import { useSteamGames, useSteamAchievements } from "@/hooks/use-steam-data"

function sortByUnlockDateDesc(a: any, b: any) {
  if (!a.unlocktime && !b.unlocktime) return 0
  if (!a.unlocktime) return 1
  if (!b.unlocktime) return -1
  return b.unlocktime - a.unlocktime
}

export function AchievementProgress() {
  const { games, loading: gamesLoading } = useSteamGames("recent")
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null)
  const { achievements, loading: achievementsLoading } = useSteamAchievements(selectedGameId)

  useEffect(() => {
    if (!gamesLoading && games.length > 0 && !selectedGameId) {
      const gameWithStats = games.find((game) => game.has_community_visible_stats)
      if (gameWithStats) {
        setSelectedGameId(gameWithStats.appid)
      }
    }
  }, [gamesLoading, games, selectedGameId])

  if (gamesLoading) {
    return (
      <Card className="border-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
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

  // Filtra solo los logros bloqueados y ordénalos por fecha descendente
  const lockedAchievements = Array.isArray(achievements)
    ? achievements.filter((a: any) => !a.achieved).sort(sortByUnlockDateDesc)
    : []

  return (
    <Card className="border-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-accent" />
          Achievement Progress
        </CardTitle>
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
                  variant={selectedGameId === game.appid ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedGameId(game.appid)}
                  className="text-xs"
                >
                  {game.name}
                </Button>
              ))}
            </div>

            {/* Achievement Display */}
            {selectedGameId && (
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
                        {gamesWithStats.find(g => g.appid === selectedGameId)?.name || "Game"}
                      </h3>
                      <Badge variant="secondary">
                        {lockedAchievements.length} pendientes
                      </Badge>
                    </div>

                    <div className="space-y-3">
                      {lockedAchievements.slice(0, 5).map((achievement: any, index: number) => (
                        <div key={index} className="p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors opacity-60">
                          <div className="flex items-start gap-3">
                            <img
                              src={achievement.icongray || achievement.icon || "/placeholder.svg"}
                              alt={achievement.displayName}
                              className="w-12 h-12 rounded-lg border-muted-foreground/20 grayscale"
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
                                  Pendiente
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
                    <p className="text-sm text-muted-foreground mb-2">¡No tienes logros pendientes en este juego!</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedGameId(selectedGameId)}
                      className="gap-2"
                    >
                      <RefreshCw className="h-4 w-4" />
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
