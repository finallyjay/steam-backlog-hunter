"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Trophy, Gamepad2, Clock, Target } from "lucide-react"
import { useSteamStats } from "@/hooks/use-steam-data"

export function StatsOverview() {
  const { stats, loading, error } = useSteamStats()

  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="border-2">
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-16 mb-2" />
              <Skeleton className="h-3 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-2 border-destructive/50">
          <CardContent className="pt-6">
            <p className="text-sm text-destructive">Failed to load stats</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const statsData = [
    {
      title: "Total Games",
      value: stats?.totalGames?.toString() || "0",
      description: "In your library",
      icon: Gamepad2,
      color: "text-blue-500",
    },
    {
      title: "Achievements",
      value: stats?.totalAchievements?.toString() || "0",
      description: "Unlocked",
      icon: Trophy,
      color: "text-yellow-500",
    },
    {
      title: "Hours Played",
      value: stats?.totalPlaytime?.toLocaleString() || "0",
      description: "Total playtime",
      icon: Clock,
      color: "text-green-500",
    },
    {
      title: "Perfect Games",
      value: stats?.perfectGames?.toString() || "0",
      description: "100% completed",
      icon: Target,
      color: "text-purple-500",
    },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {statsData.map((stat) => (
        <Card key={stat.title} className="border-2 hover:border-accent/50 transition-colors">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
              {stat.title}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stat.value}</div>
            <p className="text-xs text-muted-foreground">{stat.description}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
