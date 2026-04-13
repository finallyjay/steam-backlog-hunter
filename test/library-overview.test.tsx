// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { useSteamGamesMock, useSteamAchievementsBatchMock } = vi.hoisted(() => ({
  useSteamGamesMock: vi.fn(),
  useSteamAchievementsBatchMock: vi.fn(),
}))

vi.mock("@/hooks/use-steam-data", () => ({
  useSteamGames: useSteamGamesMock,
  useSteamAchievementsBatch: useSteamAchievementsBatchMock,
  invalidateSteamData: vi.fn(),
}))

// shadcn Select wraps Radix, which uses Portal/ResizeObserver — both painful
// in jsdom. Replace the composition with plain native <select>/<option>
// elements so existing tests can drive value changes (or just rely on
// initial-value props) without needing to open the dropdown.
vi.mock("@/components/ui/select", () => {
  const React = require("react") as typeof import("react")
  const SelectContext = React.createContext<{
    value: string
    onValueChange: (value: string) => void
  }>({ value: "", onValueChange: () => {} })

  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value: string
      onValueChange: (value: string) => void
      children: React.ReactNode
    }) => {
      // Collect all SelectItem children into native <option>s so the
      // underlying <select> stays a single accessible control.
      const options: React.ReactElement[] = []
      const walk = (node: React.ReactNode) => {
        React.Children.forEach(node, (child) => {
          if (!React.isValidElement(child)) return
          const el = child as React.ReactElement<{
            value?: string
            children?: React.ReactNode
          }>
          if (typeof el.props.value === "string") {
            options.push(
              <option key={el.props.value} value={el.props.value}>
                {el.props.children as React.ReactNode}
              </option>,
            )
          } else if (el.props.children) {
            walk(el.props.children)
          }
        })
      }
      walk(children)
      return (
        <SelectContext.Provider value={{ value, onValueChange }}>
          <select value={value} onChange={(e) => onValueChange(e.target.value)}>
            {options}
          </select>
        </SelectContext.Provider>
      )
    },
    SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    SelectValue: () => null,
    SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
      <option value={value}>{children}</option>
    ),
  }
})

import { LibraryOverview } from "@/components/dashboard/library-overview"

function buildGame(overrides: {
  appid: number
  name: string
  playtime_forever?: number
  unlocked_count?: number
  total_count?: number
  perfect_game?: boolean
}) {
  return {
    appid: overrides.appid,
    name: overrides.name,
    playtime_forever: overrides.playtime_forever ?? 0,
    img_icon_url: "",
    img_logo_url: "",
    unlocked_count: overrides.unlocked_count,
    total_count: overrides.total_count,
    perfect_game: overrides.perfect_game ?? false,
  }
}

const ORIGINAL_IO = globalThis.IntersectionObserver

beforeEach(() => {
  useSteamGamesMock.mockReturnValue({
    games: [],
    loading: false,
    isRefreshing: false,
    lastUpdated: null,
    error: null,
    refetch: vi.fn(),
  })
  useSteamAchievementsBatchMock.mockReturnValue({
    achievementsMap: {},
    loading: false,
    isRefreshing: false,
    lastUpdated: null,
    error: null,
    refetch: vi.fn(),
  })
  // jsdom doesn't implement IntersectionObserver
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  } as unknown as typeof IntersectionObserver
})

afterEach(() => {
  cleanup()
  globalThis.IntersectionObserver = ORIGINAL_IO
  vi.clearAllMocks()
})

describe("LibraryOverview", () => {
  it("renders the loading skeleton when the games hook is loading", () => {
    useSteamGamesMock.mockReturnValue({
      games: [],
      loading: true,
      isRefreshing: false,
      lastUpdated: null,
      error: null,
      refetch: vi.fn(),
    })
    const { container } = render(<LibraryOverview />)
    expect(container.querySelectorAll('[data-slot="skeleton"], .animate-pulse').length).toBeGreaterThan(0)
  })

  it("renders the error message when useSteamGames reports an error", () => {
    useSteamGamesMock.mockReturnValue({
      games: [],
      loading: false,
      isRefreshing: false,
      lastUpdated: null,
      error: "Something broke",
      refetch: vi.fn(),
    })
    render(<LibraryOverview />)
    expect(screen.getByText("Something broke")).toBeInTheDocument()
  })

  it("shows the empty state when there are no games", () => {
    render(<LibraryOverview />)
    expect(screen.getByText(/No games match the current filters/i)).toBeInTheDocument()
  })

  it("renders every game in the list and the total count", () => {
    useSteamGamesMock.mockReturnValue({
      games: [
        buildGame({ appid: 620, name: "Portal 2", playtime_forever: 600, unlocked_count: 29, total_count: 51 }),
        buildGame({
          appid: 440,
          name: "Team Fortress 2",
          playtime_forever: 6000,
          unlocked_count: 210,
          total_count: 520,
        }),
      ],
      loading: false,
      isRefreshing: false,
      lastUpdated: null,
      error: null,
      refetch: vi.fn(),
    })
    render(<LibraryOverview />)
    expect(screen.getByText("Portal 2")).toBeInTheDocument()
    expect(screen.getByText("Team Fortress 2")).toBeInTheDocument()
    expect(screen.getByText("2 games")).toBeInTheDocument()
  })

  it("filters by name via the search input (after debounce)", async () => {
    vi.useFakeTimers()
    useSteamGamesMock.mockReturnValue({
      games: [
        buildGame({ appid: 620, name: "Portal 2", playtime_forever: 100, unlocked_count: 1, total_count: 1 }),
        buildGame({ appid: 440, name: "Team Fortress 2", playtime_forever: 100, unlocked_count: 1, total_count: 1 }),
      ],
      loading: false,
      isRefreshing: false,
      lastUpdated: null,
      error: null,
      refetch: vi.fn(),
    })
    render(<LibraryOverview />)
    const searchInput = screen.getByPlaceholderText("Search games...")
    fireEvent.change(searchInput, { target: { value: "portal" } })
    // debounce is 300ms
    await vi.advanceTimersByTimeAsync(300)
    vi.useRealTimers()
    await waitFor(() => {
      expect(screen.queryByText("Team Fortress 2")).not.toBeInTheDocument()
    })
    expect(screen.getByText("Portal 2")).toBeInTheDocument()
    expect(screen.getByText("1 of 2 games")).toBeInTheDocument()
  })

  it("filters to Perfect games when the Completion dropdown is set to 'perfect'", () => {
    useSteamGamesMock.mockReturnValue({
      games: [
        buildGame({ appid: 1, name: "Perfect Game", unlocked_count: 10, total_count: 10, perfect_game: true }),
        buildGame({ appid: 2, name: "Started Game", unlocked_count: 3, total_count: 10 }),
        buildGame({ appid: 3, name: "Not Started", unlocked_count: 0, total_count: 10 }),
      ],
      loading: false,
      isRefreshing: false,
      lastUpdated: null,
      error: null,
      refetch: vi.fn(),
    })
    render(<LibraryOverview initialFilter="perfect" />)
    expect(screen.getByText("Perfect Game")).toBeInTheDocument()
    expect(screen.queryByText("Started Game")).not.toBeInTheDocument()
    // "Not Started" also appears as a mocked select option — scope our check
    // to rendered game cards only.
    expect(screen.queryByRole("heading", { name: "Not Started" })).not.toBeInTheDocument()
  })

  it("filters by achievement scope='with' to exclude zero-achievement games", () => {
    useSteamGamesMock.mockReturnValue({
      games: [
        buildGame({ appid: 1, name: "Has Achievements", unlocked_count: 1, total_count: 10 }),
        buildGame({ appid: 2, name: "No Achievements", total_count: 0 }),
      ],
      loading: false,
      isRefreshing: false,
      lastUpdated: null,
      error: null,
      refetch: vi.fn(),
    })
    render(<LibraryOverview initialAchievements="with" />)
    expect(screen.getByText("Has Achievements")).toBeInTheDocument()
    expect(screen.queryByText("No Achievements")).not.toBeInTheDocument()
  })

  it("filters to played games when played=played", () => {
    useSteamGamesMock.mockReturnValue({
      games: [
        buildGame({ appid: 1, name: "Played Game", playtime_forever: 120 }),
        buildGame({ appid: 2, name: "Never Played", playtime_forever: 0 }),
      ],
      loading: false,
      isRefreshing: false,
      lastUpdated: null,
      error: null,
      refetch: vi.fn(),
    })
    render(<LibraryOverview initialPlayed="played" />)
    expect(screen.getByText("Played Game")).toBeInTheDocument()
    expect(screen.queryByText("Never Played")).not.toBeInTheDocument()
  })

  it("counts pinned games with unlocks as 'played' even when playtime is 0", () => {
    // Regression: FaceRig & friends have playtime=0 because GetOwnedGames
    // doesn't return them, but we know they've been played because there
    // are unlocked achievements. They must not fall into "not played".
    useSteamGamesMock.mockReturnValue({
      games: [
        buildGame({ appid: 1, name: "FaceRig", playtime_forever: 0, unlocked_count: 37, total_count: 37 }),
        buildGame({ appid: 2, name: "Unplayed Shelf-Dust", playtime_forever: 0, unlocked_count: 0, total_count: 10 }),
      ],
      loading: false,
      isRefreshing: false,
      lastUpdated: null,
      error: null,
      refetch: vi.fn(),
    })
    render(<LibraryOverview initialPlayed="played" />)
    expect(screen.getByText("FaceRig")).toBeInTheDocument()
    expect(screen.queryByText("Unplayed Shelf-Dust")).not.toBeInTheDocument()
  })

  it("excludes pinned games with unlocks from 'not played'", () => {
    useSteamGamesMock.mockReturnValue({
      games: [
        buildGame({ appid: 1, name: "FaceRig", playtime_forever: 0, unlocked_count: 37, total_count: 37 }),
        buildGame({ appid: 2, name: "Unplayed Shelf-Dust", playtime_forever: 0, unlocked_count: 0, total_count: 10 }),
      ],
      loading: false,
      isRefreshing: false,
      lastUpdated: null,
      error: null,
      refetch: vi.fn(),
    })
    render(<LibraryOverview initialPlayed="notplayed" />)
    expect(screen.queryByText("FaceRig")).not.toBeInTheDocument()
    expect(screen.getByText("Unplayed Shelf-Dust")).toBeInTheDocument()
  })

  it("falls back to default when an invalid initial filter is passed", () => {
    useSteamGamesMock.mockReturnValue({
      games: [buildGame({ appid: 1, name: "Only Game", playtime_forever: 1 })],
      loading: false,
      isRefreshing: false,
      lastUpdated: null,
      error: null,
      refetch: vi.fn(),
    })
    render(
      <LibraryOverview initialFilter="bogus" initialOrder="bogus" initialAchievements="bogus" initialPlayed="bogus" />,
    )
    expect(screen.getByText("Only Game")).toBeInTheDocument()
  })
})
