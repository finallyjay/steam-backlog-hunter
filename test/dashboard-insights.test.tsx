// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { useSteamGamesMock } = vi.hoisted(() => ({
  useSteamGamesMock: vi.fn(),
}))

// Recharts uses ResizeObserver / layout measurement that jsdom doesn't do
// well. Replace the top-level chart components with transparent pass-throughs.
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PieChart: ({ children }: { children: React.ReactNode }) => <div data-testid="pie-chart">{children}</div>,
  Pie: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Cell: () => null,
  Tooltip: () => null,
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  XAxis: () => null,
  YAxis: () => null,
}))

vi.mock("@/hooks/use-steam-data", () => ({
  useSteamGames: useSteamGamesMock,
}))

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))

vi.mock("@/components/ui/animated-number", () => ({
  AnimatedNumber: ({ value }: { value: number }) => <>{value}</>,
}))

import { DashboardInsights } from "@/components/dashboard/dashboard-insights"
import type { SteamStatsResponse } from "@/lib/types/steam"

function hookReturn(games: Array<{ playtime_forever: number; unlocked_count?: number }> = []) {
  return {
    games: games.map((g, i) => ({
      appid: 100 + i,
      name: `Game ${i}`,
      playtime_forever: g.playtime_forever,
      img_icon_url: "",
      img_logo_url: "",
      unlocked_count: g.unlocked_count,
    })),
    loading: false,
    isRefreshing: false,
    lastUpdated: null,
    error: null,
    refetch: vi.fn(),
  }
}

const baseStats: SteamStatsResponse = {
  totalGames: 100,
  gamesWithAchievements: 70,
  totalAchievements: 500,
  pendingAchievements: 200,
  startedGames: 30,
  averageCompletion: 50,
  totalPlaytime: 2000,
  perfectGames: 5,
}

beforeEach(() => {
  useSteamGamesMock.mockReturnValue(hookReturn())
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("DashboardInsights", () => {
  it("renders both Completion and All Library cards", () => {
    render(<DashboardInsights stats={baseStats} />)
    expect(screen.getByText("Completion")).toBeInTheDocument()
    expect(screen.getByText("All Library")).toBeInTheDocument()
  })

  it("computes the completion model values correctly", () => {
    render(<DashboardInsights stats={baseStats} />)
    // Breakdown: perfect=5, started=30-5=25, untouched=70-30=40
    expect(screen.getByText("Perfect")).toBeInTheDocument()
    expect(screen.getByText("Started")).toBeInTheDocument()
    expect(screen.getByText("Not Started")).toBeInTheDocument()
    // Insight line combines them into a sentence
    expect(
      screen.getByText(/5 games are perfect, 25 are in progress, and 40 have not been started/),
    ).toBeInTheDocument()
  })

  it("renders a placeholder insight when stats is null", () => {
    render(<DashboardInsights stats={null} />)
    expect(screen.getByText(/Sync data to reveal completion state/i)).toBeInTheDocument()
  })

  it("switches the library card to playtime bands when the toggle is clicked", () => {
    useSteamGamesMock.mockReturnValue(
      hookReturn([
        { playtime_forever: 30 }, // 0.5h
        { playtime_forever: 60 * 3 }, // 3h
        { playtime_forever: 60 * 10 }, // 10h
        { playtime_forever: 60 * 50 }, // 50h
      ]),
    )
    render(<DashboardInsights stats={baseStats} />)
    const playtimeButton = screen.getByRole("button", { name: /Playtime/i })
    fireEvent.click(playtimeButton)
    expect(screen.getByText("<1h")).toBeInTheDocument()
    expect(screen.getByText("1-5h")).toBeInTheDocument()
    expect(screen.getByText("25h+")).toBeInTheDocument()
    expect(screen.getByText(/1 games under 1 hour, 1 with 25\+ hours logged/)).toBeInTheDocument()
  })

  it("shows library-state insight with played vs unplayed counts", () => {
    useSteamGamesMock.mockReturnValue(
      hookReturn([{ playtime_forever: 100 }, { playtime_forever: 0 }, { playtime_forever: 50 }]),
    )
    render(<DashboardInsights stats={baseStats} />)
    expect(screen.getByText("Library State")).toBeInTheDocument()
    expect(screen.getByText(/2 of 3 games have been launched/)).toBeInTheDocument()
  })

  it("counts pinned games with unlocks as 'played' in the library-state insight", () => {
    // Regression: a FaceRig-style entry with 0 playtime but unlocked
    // achievements must still be counted as played, not dumped into the
    // 'unplayed' slice of the donut.
    useSteamGamesMock.mockReturnValue(
      hookReturn([
        { playtime_forever: 0, unlocked_count: 37 }, // FaceRig — pinned
        { playtime_forever: 0, unlocked_count: 0 }, // genuine shelf-dust
        { playtime_forever: 100, unlocked_count: 0 }, // played, no unlocks yet
      ]),
    )
    render(<DashboardInsights stats={baseStats} />)
    expect(screen.getByText(/2 of 3 games have been launched/)).toBeInTheDocument()
  })

  it("shows the backlog-coverage placeholder when the library is empty", () => {
    render(<DashboardInsights stats={baseStats} />)
    expect(screen.getByText(/Load the library to reveal backlog coverage/i)).toBeInTheDocument()
  })

  it("shows the playtime-bands placeholder when the library is empty", () => {
    render(<DashboardInsights stats={baseStats} />)
    fireEvent.click(screen.getByRole("button", { name: /Playtime/i }))
    expect(screen.getByText(/Load the full library to reveal playtime bands/i)).toBeInTheDocument()
  })

  it("renders the loading 'Waiting for chart data' placeholder when loading", () => {
    render(<DashboardInsights stats={null} loading />)
    // Completion card shows loading
    expect(screen.getAllByText(/Waiting for chart data/i).length).toBeGreaterThan(0)
  })

  it("links completion slices to their filter destinations", () => {
    const { container } = render(<DashboardInsights stats={baseStats} />)
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"))
    expect(hrefs.some((h) => h?.includes("filter=perfect"))).toBe(true)
    expect(hrefs.some((h) => h?.includes("filter=started"))).toBe(true)
    expect(hrefs.some((h) => h?.includes("filter=notstarted"))).toBe(true)
  })
})
