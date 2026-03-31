"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { Pie, PieChart, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis } from "recharts"
import { PieChart as PieChartIcon, Trophy } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { AnimatedNumber } from "@/components/ui/animated-number"
import { useSteamGames } from "@/hooks/use-steam-data"
import type { SteamStatsResponse } from "@/lib/types/steam"

interface DashboardInsightsProps {
  stats: SteamStatsResponse | null
  loading?: boolean
}

type LibraryMetric = "state" | "playtime"
type ChartKind = "donut" | "bars"

const CHART_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
]

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ name: string; value: number; payload: { color: string; name?: string } }>
}) {
  if (!active || !payload?.length) return null

  const item = payload[0]
  return (
    <div className="border-surface-4 rounded-xl border bg-slate-900/95 px-3 py-2 shadow-xl backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.payload.color }} />
        <span className="text-muted-foreground text-sm">{item.payload.name ?? item.name}</span>
        <span className="text-foreground ml-1 text-sm font-semibold">{item.value}</span>
      </div>
    </div>
  )
}

function MetricLegend({ label, value, color, href }: { label: string; value: number; color: string; href?: string }) {
  const inner = (
    <>
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-muted-foreground text-sm">{label}</span>
      </div>
      <span className="text-foreground text-sm font-medium">
        <AnimatedNumber value={value} />
      </span>
    </>
  )

  if (href) {
    return (
      <Link
        href={href}
        className="bg-surface-1 hover:bg-surface-2 flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors"
      >
        {inner}
      </Link>
    )
  }

  return <div className="bg-surface-1 flex items-center justify-between rounded-lg px-3 py-2.5">{inner}</div>
}

function InsightCard({
  title,
  data,
  insight,
  loading,
  chartKind = "donut",
  links,
}: {
  title: string
  data: Array<{ name: string; value: number }>
  insight: string
  loading: boolean
  chartKind?: ChartKind
  links?: Record<string, string>
}) {
  const chartData = data.map((entry, index) => ({ ...entry, color: CHART_COLORS[index] }))

  return (
    <div className="grid gap-5">
      <div className="border-surface-3 bg-surface-1 rounded-lg border p-4">
        <div className="mb-3">
          <p className="text-foreground text-sm font-semibold">{title}</p>
          <p className="text-muted-foreground text-sm">{insight}</p>
        </div>
        <div className="h-56 min-h-0 min-w-0">
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
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
                  <Bar dataKey="value" radius={4} barSize={20}>
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
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              )}
            </ResponsiveContainer>
          ) : (
            <div className="text-muted-foreground border-surface-3 bg-surface-1 flex h-full items-center justify-center rounded-2xl border text-sm">
              Waiting for chart data
            </div>
          )}
        </div>
      </div>

      <div
        className="grid gap-3 transition-[grid-template-rows] duration-300 ease-in-out"
        style={{ gridTemplateRows: `repeat(${chartData.length}, 1fr)` }}
      >
        {chartData.map((entry, i) => (
          <div
            key={entry.name}
            className="animate-in fade-in slide-in-from-bottom-2 fill-mode-both"
            style={{ animationDelay: `${i * 50}ms`, animationDuration: "300ms" }}
          >
            <MetricLegend label={entry.name} value={entry.value} color={entry.color} href={links?.[entry.name]} />
          </div>
        ))}
      </div>
    </div>
  )
}

export function DashboardInsights({ stats, loading = false }: DashboardInsightsProps) {
  const [libraryMetric, setLibraryMetric] = useState<LibraryMetric>("state")
  const { games: allGames, loading: allGamesLoading } = useSteamGames("all")

  const completionModel = useMemo(() => {
    const perfect = stats?.perfectGames ?? 0
    const started = Math.max((stats?.startedGames ?? 0) - perfect, 0)
    const untouched = Math.max((stats?.gamesWithAchievements ?? 0) - (stats?.startedGames ?? 0), 0)

    return {
      title: "Completion State",
      data: [
        { name: "Not Started", value: untouched },
        { name: "Started", value: started },
        { name: "Perfect", value: perfect },
      ],
      insight: stats
        ? `${perfect} games are perfect, ${started} are in progress, and ${untouched} have not been started yet.`
        : "Sync data to reveal completion state.",
    }
  }, [stats])

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
        data: bands,
        insight:
          allGames.length > 0
            ? `${bands[0].value} games remain untouched, while ${bands[3].value} already have 50+ hours logged.`
            : "Load the full library to reveal playtime bands.",
        chartKind: "bars" as const,
      }
    }

    const played = allGames.filter((game) => game.playtime_forever > 0).length
    const unplayed = Math.max(allGames.length - played, 0)

    return {
      title: "Library State",
      data: [
        { name: "Played", value: played },
        { name: "Unplayed", value: unplayed },
      ],
      insight:
        allGames.length > 0
          ? `${played} of ${allGames.length} games have been launched at least once.`
          : "Load the library to reveal backlog coverage.",
      chartKind: "donut" as const,
    }
  }, [allGames, libraryMetric])

  return (
    <div className="grid gap-6">
      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="border-surface-4">
          <CardHeader>
            <div className="flex items-center gap-2 text-lg">
              <PieChartIcon className="text-accent h-5 w-5" />
              <CardTitle>Completion</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <InsightCard
              title={completionModel.title}
              data={completionModel.data}
              insight={completionModel.insight}
              loading={loading}
              chartKind="donut"
              links={{
                Perfect: "/games?played=played&filter=perfect&achievements=with",
                Started: "/games?played=played&filter=started&achievements=with",
                "Not Started": "/games?played=played&filter=notstarted&achievements=with",
              }}
            />
          </CardContent>
        </Card>

        <Card className="border-surface-4">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-lg">
                <Trophy className="text-accent h-5 w-5" />
                <CardTitle>All Library</CardTitle>
              </div>
              <div className="flex gap-1">
                <Button
                  variant={libraryMetric === "state" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setLibraryMetric("state")}
                  className={
                    libraryMetric === "state"
                      ? "bg-accent text-accent-foreground hover:bg-accent/90 h-7 px-2.5 text-xs"
                      : "text-muted-foreground hover:text-foreground border-surface-3 bg-surface-1 hover:bg-surface-3 h-7 border px-2.5 text-xs"
                  }
                >
                  State
                </Button>
                <Button
                  variant={libraryMetric === "playtime" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setLibraryMetric("playtime")}
                  className={
                    libraryMetric === "playtime"
                      ? "bg-accent text-accent-foreground hover:bg-accent/90 h-7 px-2.5 text-xs"
                      : "text-muted-foreground hover:text-foreground border-surface-3 bg-surface-1 hover:bg-surface-3 h-7 border px-2.5 text-xs"
                  }
                >
                  Playtime
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <InsightCard
              title={libraryModel.title}
              data={libraryModel.data}
              insight={libraryModel.insight}
              loading={allGamesLoading}
              chartKind={libraryModel.chartKind}
              links={
                libraryMetric === "state"
                  ? {
                      Played: "/games?played=played",
                      Unplayed: "/games?played=notplayed",
                    }
                  : undefined
              }
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
