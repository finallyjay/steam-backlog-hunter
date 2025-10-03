"use client"

import { Trophy, Gamepad2, Clock, Target } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { useRouter } from "next/navigation"
import { useSteamStats } from "@/hooks/use-steam-data"
import { CardGrid } from "@/components/ui/card-grid"

export function StatsOverview() {
  const { stats, loading, error } = useSteamStats()

  if (loading) {
    return <CardGrid items={Array.from({ length: 4 }).map((_, i) => ({ title: "", value: "", description: "", icon: <Skeleton className="h-8 w-8" /> }))} />
  }

  if (error) {
    return <CardGrid items={[{ title: "Error", description: "Failed to load stats", icon: <Trophy className="h-8 w-8 text-destructive" /> }]} />
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

  const router = useRouter()
  return (
    <CardGrid
      items={statsData.map((stat, idx) => ({
        title: stat.title,
        value: stat.value,
        description: stat.description,
        icon: <stat.icon className={`h-4 w-4 ${stat.color}`} />,
        onClick: idx === 0 ? () => router.push('/games') : undefined,
        clickable: idx === 0,
      }))}
    />
  )
}
