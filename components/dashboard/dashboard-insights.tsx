"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { Pie, PieChart, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, Sector } from "recharts"
import type { PieSectorDataItem } from "recharts/types/polar/Pie"
import { PieChart as PieChartIcon, Trophy } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { AnimatedNumber } from "@/components/ui/animated-number"
import { useSteamGames } from "@/hooks/use-steam-data"
import { cn } from "@/lib/utils"
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

const CHART_GRADIENT_IDS = ["chart-grad-1", "chart-grad-2", "chart-grad-3", "chart-grad-4", "chart-grad-5"]

// SVG <defs> with one vertical linearGradient per chart color slot, going
// from full opacity (top) to 0.55 (bottom). Adds depth without changing the
// palette identity. Rendered as the first child of each Recharts chart.
function ChartGradients() {
  return (
    <defs>
      {CHART_COLORS.map((color, i) => (
        <linearGradient key={CHART_GRADIENT_IDS[i]} id={CHART_GRADIENT_IDS[i]} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.95} />
          <stop offset="100%" stopColor={color} stopOpacity={0.55} />
        </linearGradient>
      ))}
    </defs>
  )
}

// Custom hover shape for Pie slices: same geometry as the static slice but
// nudged ~4px outward and with a soft accent glow via drop-shadow.
function ActivePieShape(props: PieSectorDataItem) {
  const { cx, cy, innerRadius, outerRadius = 0, startAngle, endAngle, fill } = props
  return (
    <Sector
      cx={cx}
      cy={cy}
      innerRadius={innerRadius}
      outerRadius={outerRadius + 4}
      startAngle={startAngle}
      endAngle={endAngle}
      fill={fill}
      style={{ filter: "drop-shadow(0 0 8px rgba(97, 206, 255, 0.45))" }}
    />
  )
}

// Factory: returns a Tooltip component that closes over the total of all
// chart values, so it can render each slice as both an absolute count and a
// percentage of the whole.
function createChartTooltip(total: number) {
  return function ChartTooltip({
    active,
    payload,
  }: {
    active?: boolean
    payload?: Array<{ name: string; value: number; payload: { color: string; name?: string } }>
  }) {
    if (!active || !payload?.length) return null

    const item = payload[0]
    const percent = total > 0 ? Math.round((item.value / total) * 100) : 0
    const color = item.payload.color
    return (
      <div
        className="border-surface-4 relative overflow-hidden rounded-xl border bg-slate-900/95 px-3 py-2 shadow-[0_18px_60px_-25px_rgba(0,0,0,0.85),0_2px_8px_-4px_rgba(0,0,0,0.45)] backdrop-blur-md"
        style={{ borderTopColor: color, borderTopWidth: 2 }}
      >
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-muted-foreground text-sm">{item.payload.name ?? item.name}</span>
          <span className="text-foreground ml-1 text-sm font-semibold tabular-nums">{item.value}</span>
          <span className="text-muted-foreground/80 text-xs tabular-nums">({percent}%)</span>
        </div>
      </div>
    )
  }
}

const METRIC_LEGEND_BASE = "bg-surface-1 flex items-center justify-between rounded-lg px-3 py-2.5"

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
      <Link href={href} className={cn(METRIC_LEGEND_BASE, "hover:bg-surface-2 transition-colors")}>
        {inner}
      </Link>
    )
  }
  return <div className={METRIC_LEGEND_BASE}>{inner}</div>
}

function InsightChartFrame({
  title,
  insight,
  children,
}: {
  title: string
  insight: string
  children: React.ReactNode
}) {
  return (
    <div className="border-surface-3 bg-surface-1 rounded-lg border p-4">
      <div className="mb-3">
        <p className="text-foreground text-sm font-semibold">{title}</p>
        <p className="text-muted-foreground text-sm">{insight}</p>
      </div>
      <div className="h-56 min-h-0 min-w-0">{children}</div>
    </div>
  )
}

function ChartLoadingPlaceholder() {
  return (
    <div className="text-muted-foreground border-surface-3 bg-surface-1 flex h-full items-center justify-center rounded-2xl border text-sm">
      Waiting for chart data
    </div>
  )
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
  const chartData = data.map((entry, index) => ({
    ...entry,
    color: CHART_COLORS[index],
    fillUrl: `url(#${CHART_GRADIENT_IDS[index]})`,
  }))
  const total = chartData.reduce((sum, e) => sum + e.value, 0)
  const TooltipContent = useMemo(() => createChartTooltip(total), [total])

  return (
    <div className="grid gap-5">
      <InsightChartFrame title={title} insight={insight}>
        {!loading ? (
          // Explicit pixel height avoids recharts' "width(-1) and height(-1)"
          // warning on first render — ResponsiveContainer only needs to
          // measure the (stable) horizontal axis of the parent.
          <ResponsiveContainer width="100%" height={224}>
            {chartKind === "bars" ? (
              <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <ChartGradients />
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  width={72}
                  tick={{ fill: "rgba(226,232,240,0.72)", fontSize: 12 }}
                />
                <Tooltip content={<TooltipContent />} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
                <Bar dataKey="value" radius={4} barSize={20} animationBegin={0} animationDuration={500}>
                  {chartData.map((entry) => (
                    <Cell key={entry.name} fill={entry.fillUrl} />
                  ))}
                </Bar>
              </BarChart>
            ) : (
              <PieChart>
                <ChartGradients />
                <Pie
                  data={chartData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={56}
                  outerRadius={84}
                  paddingAngle={3}
                  stroke="transparent"
                  activeShape={ActivePieShape}
                  animationBegin={0}
                  animationDuration={500}
                >
                  {chartData.map((entry) => (
                    <Cell key={entry.name} fill={entry.fillUrl} />
                  ))}
                </Pie>
                <Tooltip content={<TooltipContent />} />
              </PieChart>
            )}
          </ResponsiveContainer>
        ) : (
          <ChartLoadingPlaceholder />
        )}
      </InsightChartFrame>

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
        { name: "<1h", value: 0 },
        { name: "1-5h", value: 0 },
        { name: "5-25h", value: 0 },
        { name: "25h+", value: 0 },
      ]

      for (const game of allGames) {
        const hours = game.playtime_forever / 60
        if (hours < 1) bands[0].value += 1
        else if (hours < 5) bands[1].value += 1
        else if (hours < 25) bands[2].value += 1
        else bands[3].value += 1
      }

      return {
        title: "Playtime Bands",
        data: bands,
        insight:
          allGames.length > 0
            ? `${bands[0].value} games under 1 hour, ${bands[3].value} with 25+ hours logged.`
            : "Load the full library to reveal playtime bands.",
        chartKind: "bars" as const,
      }
    }

    // "Played" counts any game with either logged playtime OR at least one
    // unlocked achievement — matches the library-overview filter and keeps
    // delisted/pinned games (FaceRig, Free to Play, …) out of the unplayed
    // bucket even though GetOwnedGames reports 0 playtime for them.
    const played = allGames.filter((game) => game.playtime_forever > 0 || (game.unlocked_count ?? 0) > 0).length
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
              <ToggleGroup
                type="single"
                value={libraryMetric}
                onValueChange={(value) => {
                  // Radix returns "" when the user clicks the active item;
                  // ignore that to keep one option always selected.
                  if (value) setLibraryMetric(value as LibraryMetric)
                }}
                variant="outline"
                size="sm"
                aria-label="Library metric"
              >
                <ToggleGroupItem value="state" className="h-7 px-2.5 text-xs">
                  State
                </ToggleGroupItem>
                <ToggleGroupItem value="playtime" className="h-7 px-2.5 text-xs">
                  Playtime
                </ToggleGroupItem>
              </ToggleGroup>
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
