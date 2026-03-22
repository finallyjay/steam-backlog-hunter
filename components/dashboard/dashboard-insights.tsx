"use client"

import { useEffect, useMemo, useState } from "react"
import { Pie, PieChart, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis } from "recharts"
import { Activity, PieChart as PieChartIcon, Trophy } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { AnimatedNumber } from "@/components/ui/animated-number"
import { useSteamGames } from "@/hooks/use-steam-data"
import { getAllowedGameIdsClient } from "@/lib/allowed-games"
import type { SteamStatsResponse } from "@/lib/types/steam"

interface DashboardInsightsProps {
  stats: SteamStatsResponse | null
  loading?: boolean
}

type TrackableMetric = "achievements" | "completion"
type LibraryMetric = "state" | "playtime"
type ChartKind = "donut" | "bars"

const CHART_COLORS = ["#61ceff", "#53d1a8", "#f3c969", "#2d415c", "#f58f74"]

function MetricLegend({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-white/8 bg-white/4 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <span className="text-sm font-medium text-foreground">
        <AnimatedNumber value={value} />
      </span>
    </div>
  )
}

function InsightCard({
  title,
  description,
  data,
  insight,
  loading,
  chartKind = "donut",
}: {
  title: string
  description: string
  data: Array<{ name: string; value: number }>
  insight: string
  loading: boolean
  chartKind?: ChartKind
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
              {chartKind === "bars" ? (
                <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    width={72}
                    tick={{ fill: "rgba(226,232,240,0.72)", fontSize: 12 }}
                  />
                  <Tooltip />
                  <Bar dataKey="value" radius={999}>
                    {chartData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              ) : (
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
              )}
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
  const [libraryMetric, setLibraryMetric] = useState<LibraryMetric>("state")
  const [trackableCount, setTrackableCount] = useState<number | null>(null)
  const { games: allGames, loading: allGamesLoading } = useSteamGames("all")

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
      const started = Math.max((stats?.startedGames ?? 0) - perfect, 0)
      const untouched = Math.max((trackableCount ?? 0) - (stats?.startedGames ?? 0), 0)

      return {
        title: "Completion State",
        description: "Which tracked games are fully done, started, or still untouched.",
        data: [
          { name: "Perfect", value: perfect },
          { name: "Started", value: started },
          { name: "Untouched", value: untouched },
        ],
        insight: stats
          ? `${perfect} tracked games are perfect, ${started} are in progress, and ${untouched} have not been started yet.`
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
    if (libraryMetric === "playtime") {
      const bands = [
        { name: "0h", value: 0 },
        { name: "<10h", value: 0 },
        { name: "10-50h", value: 0 },
        { name: "50h+", value: 0 },
      ]

      for (const game of allGames) {
        const hours = game.playtime_forever / 60
        if (hours === 0) bands[0].value += 1
        else if (hours < 10) bands[1].value += 1
        else if (hours < 50) bands[2].value += 1
        else bands[3].value += 1
      }

      return {
        title: "Playtime Bands",
        description: "How your full library is distributed by time spent.",
        data: bands,
        insight: allGames.length > 0
          ? `${bands[0].value} games remain untouched, while ${bands[3].value} already have 50+ hours logged.`
          : "Load the full library to reveal playtime bands.",
        chartKind: "bars" as const,
      }
    }

    const played = allGames.filter((game) => game.playtime_forever > 0).length
    const unplayed = Math.max(allGames.length - played, 0)

    return {
      title: "Library State",
      description: "Played games versus the untouched backlog across your whole library.",
      data: [
        { name: "Played", value: played },
        { name: "Unplayed", value: unplayed },
      ],
      insight: allGames.length > 0
        ? `${played} of ${allGames.length} games have been launched at least once.`
        : "Load the library to reveal backlog coverage.",
      chartKind: "donut" as const,
    }
  }, [allGames, libraryMetric])

  return (
    <div className="grid gap-6">
      <div className="rounded-[1.25rem] border border-white/8 bg-white/4 px-4 py-4">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Average Completion</p>
        <div className="mt-2 flex items-end gap-2">
          <span className="text-3xl font-semibold tracking-tight text-foreground">
            <AnimatedNumber value={Math.floor(stats?.averageCompletion ?? 0)} />
          </span>
          <span className="pb-1 text-sm text-muted-foreground">% avg completion</span>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">Average completion across games with at least one unlocked achievement.</p>
      </div>

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
            chartKind="donut"
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
              variant={libraryMetric === "state" ? "default" : "ghost"}
              size="sm"
              onClick={() => setLibraryMetric("state")}
              className={libraryMetric === "state" ? "bg-accent text-accent-foreground hover:bg-accent/90" : "border border-white/8 bg-white/4 text-muted-foreground hover:bg-white/8 hover:text-foreground"}
            >
              State
            </Button>
            <Button
              variant={libraryMetric === "playtime" ? "default" : "ghost"}
              size="sm"
              onClick={() => setLibraryMetric("playtime")}
              className={libraryMetric === "playtime" ? "bg-accent text-accent-foreground hover:bg-accent/90" : "border border-white/8 bg-white/4 text-muted-foreground hover:bg-white/8 hover:text-foreground"}
            >
              Playtime
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <InsightCard
            title={libraryModel.title}
            description={libraryModel.description}
            data={libraryModel.data}
            insight={libraryModel.insight}
            loading={allGamesLoading}
            chartKind={libraryModel.chartKind}
          />
        </CardContent>
      </Card>
      </div>
    </div>
  )
}
