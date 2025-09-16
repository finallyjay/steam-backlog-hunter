"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Clock, Play } from "lucide-react"
import { useSteamGames } from "@/hooks/use-steam-data"
import { getSteamImageUrl } from "@/lib/steam-api"

export function RecentGames() {
  const { games, loading, error } = useSteamGames("recent")

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

  const recentGames = games.slice(0, 6).map((game) => ({
    id: game.appid.toString(),
    name: game.name,
    playtime: `${Math.round(game.playtime_forever / 60)} hours`,
    lastPlayed: game.playtime_2weeks ? `${Math.round(game.playtime_2weeks / 60)} hours (2 weeks)` : "Not recently",
    image: getSteamImageUrl(game.appid, game.img_icon_url, "icon"),
    appid: game.appid,
  }))

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
            recentGames.map((game) => (
              <div
                key={game.id}
                className="flex items-center gap-4 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors cursor-pointer"
              >
                <img
                  src={game.image || "/placeholder.svg"}
                  alt={game.name}
                  className="w-16 h-16 rounded-lg border"
                  onError={(e) => {
                    e.currentTarget.src = "/generic-game-icon.png"
                  }}
                />

                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold truncate">{game.name}</h3>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>{game.playtime}</span>
                    {game.lastPlayed !== "Not recently" && (
                      <>
                        <span>•</span>
                        <span>{game.lastPlayed}</span>
                      </>
                    )}
                  </div>
                  <div className="mt-1">
                    <Badge variant="outline" className="text-xs">
                      App ID: {game.appid}
                    </Badge>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  )
}
