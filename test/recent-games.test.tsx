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

const ORIGINAL_FETCH = globalThis.fetch

import { RecentGames } from "@/components/dashboard/recent-games"

function defaultHookReturn(overrides: { games?: unknown[]; loading?: boolean; error?: unknown } = {}) {
  return {
    games: [],
    loading: false,
    isRefreshing: false,
    lastUpdated: null,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  useSteamGamesMock.mockReturnValue(defaultHookReturn())
  useSteamAchievementsBatchMock.mockReturnValue({
    achievementsMap: {},
    loading: false,
    isRefreshing: false,
    lastUpdated: null,
    error: null,
    refetch: vi.fn(),
  })
})

afterEach(() => {
  cleanup()
  globalThis.fetch = ORIGINAL_FETCH
  vi.clearAllMocks()
})

describe("RecentGames", () => {
  it("renders skeletons while loading", () => {
    useSteamGamesMock.mockReturnValueOnce(defaultHookReturn({ loading: true }))
    render(<RecentGames />)
    expect(screen.getByText("Recently Played Games")).toBeInTheDocument()
  })

  it("renders an error card when the hook reports an error", () => {
    useSteamGamesMock.mockReturnValueOnce(defaultHookReturn({ error: "boom" }))
    render(<RecentGames />)
    expect(screen.getByText(/Failed to load recent games/i)).toBeInTheDocument()
  })

  it("renders the empty state when there are no recent games", () => {
    render(<RecentGames />)
    expect(screen.getByText(/No recently played games/i)).toBeInTheDocument()
  })

  it("renders game cards when games are present", () => {
    useSteamGamesMock.mockReturnValueOnce(
      defaultHookReturn({
        games: [
          {
            appid: 620,
            name: "Portal 2",
            playtime_forever: 600,
            img_icon_url: "",
            img_logo_url: "",
            unlocked_count: 29,
            total_count: 51,
            perfect_game: false,
          },
          {
            appid: 440,
            name: "Team Fortress 2",
            playtime_forever: 6000,
            img_icon_url: "",
            img_logo_url: "",
            unlocked_count: 210,
            total_count: 520,
            perfect_game: false,
          },
        ],
      }),
    )
    render(<RecentGames />)
    expect(screen.getByText("Portal 2")).toBeInTheDocument()
    expect(screen.getByText("Team Fortress 2")).toBeInTheDocument()
  })

  it("limits the visible list to the top 6 recent games", () => {
    useSteamGamesMock.mockReturnValueOnce(
      defaultHookReturn({
        games: Array.from({ length: 10 }, (_, i) => ({
          appid: 100 + i,
          name: `Game ${i}`,
          playtime_forever: 100,
          img_icon_url: "",
          img_logo_url: "",
          unlocked_count: 0,
          total_count: 0,
          perfect_game: false,
        })),
      }),
    )
    render(<RecentGames />)
    expect(screen.getByText("Game 0")).toBeInTheDocument()
    expect(screen.getByText("Game 5")).toBeInTheDocument()
    expect(screen.queryByText("Game 6")).not.toBeInTheDocument()
  })

  it("hides a game locally after a successful POST /api/steam/games/hide", async () => {
    useSteamGamesMock.mockReturnValue(
      defaultHookReturn({
        games: [
          {
            appid: 620,
            name: "Portal 2",
            playtime_forever: 100,
            img_icon_url: "",
            img_logo_url: "",
            unlocked_count: 0,
            total_count: 0,
            perfect_game: false,
          },
        ],
      }),
    )
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as unknown as Response)

    render(<RecentGames />)
    expect(screen.getByText("Portal 2")).toBeInTheDocument()
    const hideButton = screen.getAllByLabelText(/hide/i)[0]
    fireEvent.click(hideButton)
    await waitFor(() => expect(screen.queryByText("Portal 2")).not.toBeInTheDocument())
  })
})
