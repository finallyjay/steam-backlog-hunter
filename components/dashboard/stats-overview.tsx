"use client"

import { Trophy, Gamepad2, Target, RefreshCw, ListTodo } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { useSteamStats } from "@/hooks/use-steam-data"
import { CardGrid } from "@/components/ui/card-grid"
import { Button } from "@/components/ui/button"

export function StatsOverview() {
  const { stats, loading, isRefreshing, lastUpdated, error, refetch } = useSteamStats()

  const updatedLabel = lastUpdated ? `Updated at ${lastUpdated.toLocaleTimeString()}` : "Not updated yet"

  if (loading) {
    return (
      <CardGrid
        items={Array.from({ length: 4 }).map(() => ({
          title: "",
          value: "",
          description: "",
          icon: <Skeleton className="h-8 w-8" />,
        }))}
      />
    )
  }

  if (error) {
    return (
      <CardGrid
        items={[
          {
            title: "Error",
            description: "Failed to load stats",
            icon: <Trophy className="text-destructive h-8 w-8" />,
          },
        ]}
      />
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
      title: "Pending Achievements",
      value: stats?.pendingAchievements?.toString() || "0",
      description: "Still locked",
      icon: ListTodo,
      color: "text-emerald-400",
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
    <div className="space-y-4">
      <div className="bg-card/80 flex items-center justify-between rounded-[1.2rem] border border-white/10 px-4 py-3">
        <div>
          <p className="text-accent/80 text-[0.68rem] font-semibold tracking-[0.24em] uppercase">Library pulse</p>
          <p className="text-muted-foreground text-xs">{updatedLabel}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch({ force: true })}
          disabled={isRefreshing}
          className="gap-2 border-white/10 bg-white/5 hover:bg-white/10"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>
      <CardGrid
        items={statsData.map((stat, idx) => ({
          title: stat.title,
          value: stat.value,
          description: stat.description,
          icon: <stat.icon className={`h-4 w-4 ${stat.color}`} />,
          onClick: undefined,
          clickable: false,
          className:
            idx === 0
              ? "relative before:absolute before:inset-x-6 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-accent/60 before:to-transparent"
              : "",
        }))}
      />
    </div>
  )
}
