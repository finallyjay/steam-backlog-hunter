"use client"

import { useEffect, useMemo, useState } from "react"
import { Pie, PieChart, Cell, ResponsiveContainer, Tooltip } from "recharts"
import { Activity, PieChart as PieChartIcon, Trophy } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useSteamGames } from "@/hooks/use-steam-data"
import { getAllowedGameIdsClient } from "@/lib/allowed-games"
import type { SteamStatsResponse } from "@/lib/types/steam"

interface DashboardInsightsProps {
  stats: SteamStatsResponse | null
  loading?: boolean
}

type TrackableMetric = "achievements" | "completion"
type LibraryMetric = "catalog" | "activity"

const CHART_COLORS = ["#61ceff", "#53d1a8", "#f3c969", "#2d415c", "#f58f74"]

function MetricLegend({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-white/8 bg-white/4 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  )
}

function InsightCard({
  title,
  description,
  data,
  insight,
  loading,
}: {
  title: string
  description: string
  data: Array<{ name: string; value: number }>
  insight: string
  loading: boolean
}) {
  const chartData = data.map((entry, index) => ({ ...entry, color: CHART_COLORS[index] }))

  return (
    <div className="grid gap-5">
      <div className="rounded-[1.25rem] border border-white/8 bg-white/4 p-4">
        <div className="mb-3">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="h-56">
          {!loading ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={56}
                  outerRadius={84}
                  paddingAngle={3}
                  stroke="transparent"
                >
                  {chartData.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center rounded-2xl border border-white/8 bg-white/4 text-sm text-muted-foreground">
              Waiting for chart data
            </div>
          )}
        </div>
      </div>

      <div className="rounded-[1.25rem] border border-white/8 bg-white/4 px-4 py-4">
        <p className="mb-1 flex items-center gap-2 text-sm font-medium text-foreground">
          <Activity className="h-4 w-4 text-accent" />
          Current reading
        </p>
        <p className="text-sm text-muted-foreground">{insight}</p>
      </div>

      <div className="space-y-3">
        {chartData.map((entry) => (
          <MetricLegend key={entry.name} label={entry.name} value={entry.value} color={entry.color} />
        ))}
      </div>
    </div>
  )
}

export function DashboardInsights({ stats, loading = false }: DashboardInsightsProps) {
  const [trackableMetric, setTrackableMetric] = useState<TrackableMetric>("achievements")
  const [libraryMetric, setLibraryMetric] = useState<LibraryMetric>("catalog")
  const [trackableCount, setTrackableCount] = useState<number | null>(null)
  const { games: allGames, loading: allGamesLoading } = useSteamGames("all")
  const { games: recentGames, loading: recentGamesLoading } = useSteamGames("recent")

  useEffect(() => {
    let isMounted = true

    async function loadTrackableCount() {
      try {
        const allowedIds = await getAllowedGameIdsClient()
        if (!isMounted) {
          return
        }

        const count = allGames.filter((game) => allowedIds.has(String(game.appid))).length
        setTrackableCount(count)
      } catch {
        if (isMounted) {
          setTrackableCount(null)
        }
      }
    }

    void loadTrackableCount()

    return () => {
      isMounted = false
    }
  }, [allGames])

  const trackableModel = useMemo(() => {
    if (trackableMetric === "completion") {
      const perfect = stats?.perfectGames ?? 0
      const remaining = Math.max((trackableCount ?? stats?.totalGames ?? 0) - perfect, 0)

      return {
        title: "Completion State",
        description: "Perfect trackable games versus the rest of the trackable catalog.",
        data: [
          { name: "Perfect", value: perfect },
          { name: "Not perfect", value: remaining },
        ],
        insight: stats
          ? `${perfect} trackable games are perfect and ${remaining} are still short of 100%.`
          : "Sync data to reveal trackable completion state.",
      }
    }

    return {
      title: "Achievement Split",
      description: "Unlocked versus still pending achievements across trackable games.",
      data: [
        { name: "Unlocked", value: stats?.totalAchievements ?? 0 },
        { name: "Pending", value: stats?.pendingAchievements ?? 0 },
      ],
      insight: stats
        ? `${stats.pendingAchievements} pending achievements remain in the trackable catalog.`
        : "Sync data to reveal the achievement split.",
    }
  }, [stats, trackableCount, trackableMetric])

  const libraryModel = useMemo(() => {
    if (libraryMetric === "activity") {
      const activeRecent = recentGames.length
      const idle = Math.max(allGames.length - activeRecent, 0)

      return {
        title: "Recent Activity Coverage",
        description: "Recently played games versus the rest of the full owned library.",
        data: [
          { name: "Recently played", value: activeRecent },
          { name: "Idle library", value: idle },
        ],
        insight: allGames.length > 0
          ? `${activeRecent} of ${allGames.length} owned games appeared in the recent activity snapshot.`
          : "Load the full library to reveal recent activity coverage.",
      }
    }

    const totalLibraryGames = allGames.length
    const effectiveTrackableCount = trackableCount ?? 0
    const nonTrackable = Math.max(totalLibraryGames - effectiveTrackableCount, 0)

    return {
      title: "Catalog Coverage",
      description: "Trackable games versus the rest of the owned library.",
      data: [
        { name: "Trackable games", value: effectiveTrackableCount },
        { name: "Other library games", value: nonTrackable },
      ],
      insight: totalLibraryGames > 0
        ? `${effectiveTrackableCount} of ${totalLibraryGames} owned games are part of the current trackable catalog.`
        : "Load the library to reveal catalog coverage.",
    }
  }, [allGames.length, libraryMetric, recentGames.length, trackableCount])

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card className="border-white/10">
        <CardHeader className="space-y-4">
          <div className="flex items-center gap-2 text-lg">
            <PieChartIcon className="h-5 w-5 text-accent" />
            <CardTitle>Trackable Games</CardTitle>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={trackableMetric === "achievements" ? "default" : "ghost"}
              size="sm"
              onClick={() => setTrackableMetric("achievements")}
              className={trackableMetric === "achievements" ? "bg-accent text-accent-foreground hover:bg-accent/90" : "border border-white/8 bg-white/4 text-muted-foreground hover:bg-white/8 hover:text-foreground"}
            >
              Achievements
            </Button>
            <Button
              variant={trackableMetric === "completion" ? "default" : "ghost"}
              size="sm"
              onClick={() => setTrackableMetric("completion")}
              className={trackableMetric === "completion" ? "bg-accent text-accent-foreground hover:bg-accent/90" : "border border-white/8 bg-white/4 text-muted-foreground hover:bg-white/8 hover:text-foreground"}
            >
              Completion
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <InsightCard
            title={trackableModel.title}
            description={trackableModel.description}
            data={trackableModel.data}
            insight={trackableModel.insight}
            loading={loading}
          />
        </CardContent>
      </Card>

      <Card className="border-white/10">
        <CardHeader className="space-y-4">
          <div className="flex items-center gap-2 text-lg">
            <Trophy className="h-5 w-5 text-accent" />
            <CardTitle>All Library</CardTitle>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={libraryMetric === "catalog" ? "default" : "ghost"}
              size="sm"
              onClick={() => setLibraryMetric("catalog")}
              className={libraryMetric === "catalog" ? "bg-accent text-accent-foreground hover:bg-accent/90" : "border border-white/8 bg-white/4 text-muted-foreground hover:bg-white/8 hover:text-foreground"}
            >
              Catalog
            </Button>
            <Button
              variant={libraryMetric === "activity" ? "default" : "ghost"}
              size="sm"
              onClick={() => setLibraryMetric("activity")}
              className={libraryMetric === "activity" ? "bg-accent text-accent-foreground hover:bg-accent/90" : "border border-white/8 bg-white/4 text-muted-foreground hover:bg-white/8 hover:text-foreground"}
            >
              Activity
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <InsightCard
            title={libraryModel.title}
            description={libraryModel.description}
            data={libraryModel.data}
            insight={libraryModel.insight}
            loading={allGamesLoading || recentGamesLoading}
          />
        </CardContent>
      </Card>
    </div>
  )
}
