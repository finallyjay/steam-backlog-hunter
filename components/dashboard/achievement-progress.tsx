"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Trophy, Star, RefreshCw } from "lucide-react"
import { useSteamGames, useSteamAchievements } from "@/hooks/use-steam-data"

export function AchievementProgress() {
  const { games, loading: gamesLoading } = useSteamGames("recent")
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null)
  const { achievements, loading: achievementsLoading } = useSteamAchievements(selectedGameId)

  useState(() => {
    if (!gamesLoading && games.length > 0 && !selectedGameId) {
      const gameWithStats = games.find((game) => game.has_community_visible_stats)
      if (gameWithStats) {
        setSelectedGameId(gameWithStats.appid)
      }
    }
  })

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
                ) : achievements ? (
                  <>
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold">{achievements.gameName}</h3>
                      <Badge variant="secondary">
                        {achievements.achievements.filter((a: any) => a.achieved === 1).length}/
                        {achievements.achievements.length} unlocked
                      </Badge>
                    </div>

                    <div className="space-y-3">
                      {achievements.achievements.slice(0, 5).map((achievement: any, index: number) => (
                        <div key={index} className="p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                          <div className="flex items-start gap-3">
                            <div className="relative">
                              <img
                                src={
                                  achievement.achieved === 1
                                    ? achievement.icon || "/placeholder.svg?height=48&width=48&query=achievement"
                                    : achievement.icongray ||
                                      "/placeholder.svg?height=48&width=48&query=locked achievement"
                                }
                                alt={achievement.displayName}
                                className={`w-12 h-12 rounded-lg border-2 ${
                                  achievement.achieved === 1 ? "border-accent" : "border-muted-foreground/20 grayscale"
                                }`}
                                onError={(e) => {
                                  e.currentTarget.src = "/achievement-icon.png"
                                }}
                              />
                              {achievement.achieved === 1 && (
                                <div className="absolute -top-1 -right-1 w-5 h-5 bg-accent rounded-full flex items-center justify-center">
                                  <Star className="h-3 w-3 text-accent-foreground fill-current" />
                                </div>
                              )}
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <h4 className="font-semibold truncate text-sm">
                                  {achievement.displayName || achievement.apiname}
                                </h4>
                                <Badge
                                  variant={achievement.achieved === 1 ? "default" : "secondary"}
                                  className="text-xs"
                                >
                                  {achievement.achieved === 1 ? "Unlocked" : "Locked"}
                                </Badge>
                              </div>

                              <p className="text-xs text-muted-foreground mb-2">
                                {achievement.description || "No description available"}
                              </p>

                              {achievement.achieved === 1 && achievement.unlocktime > 0 && (
                                <p className="text-xs text-muted-foreground">
                                  Unlocked: {new Date(achievement.unlocktime * 1000).toLocaleDateString()}
                                </p>
                              )}

                              <Progress value={achievement.achieved === 1 ? 100 : 0} className="mt-2 h-1" />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {achievements.achievements.length > 5 && (
                      <p className="text-xs text-muted-foreground text-center">
                        Showing 5 of {achievements.achievements.length} achievements
                      </p>
                    )}
                  </>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-sm text-muted-foreground mb-2">Failed to load achievements for this game</p>
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
