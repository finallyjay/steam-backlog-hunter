// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const ORIGINAL_FETCH = globalThis.fetch

function mockFetchSequence(handler: (url: string) => Promise<Response>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => handler(String(input))) as unknown as typeof fetch
}

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response
}

function err(status: number) {
  return { ok: false, status, json: async () => ({}) } as unknown as Response
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  vi.clearAllMocks()
})

describe("invalidateSteamData", () => {
  it("dispatches the custom event when called in the browser", async () => {
    const spy = vi.fn()
    window.addEventListener("steam-data-invalidated", spy)
    const { invalidateSteamData } = await import("@/hooks/use-steam-data")
    invalidateSteamData()
    expect(spy).toHaveBeenCalled()
    window.removeEventListener("steam-data-invalidated", spy)
  })
})

describe("useSteamGames", () => {
  it("loads games on mount and exposes loading → loaded transition", async () => {
    mockFetchSequence(async () => ok({ games: [{ appid: 620, name: "Portal 2", playtime_forever: 100 }] }))
    const { useSteamGames } = await import("@/hooks/use-steam-data")
    const { result } = renderHook(() => useSteamGames("recent"))
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.games).toHaveLength(1)
    expect(result.current.error).toBeNull()
  })

  it("sets error when the API responds with !ok", async () => {
    mockFetchSequence(async () => err(500))
    const { useSteamGames } = await import("@/hooks/use-steam-data")
    const { result } = renderHook(() => useSteamGames("recent"))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe("Failed to fetch games")
    expect(result.current.games).toEqual([])
  })

  it("sets error when the response shape is invalid", async () => {
    mockFetchSequence(async () => ok({ unexpected: "shape" }))
    const { useSteamGames } = await import("@/hooks/use-steam-data")
    const { result } = renderHook(() => useSteamGames("recent"))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe("Invalid games response")
  })

  it("refetch calls the endpoint with refresh=1", async () => {
    const urls: string[] = []
    mockFetchSequence(async (url) => {
      urls.push(url)
      return ok({ games: [] })
    })
    const { useSteamGames } = await import("@/hooks/use-steam-data")
    const { result } = renderHook(() => useSteamGames("all"))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.refetch()
    })
    expect(urls.some((u) => u.includes("refresh=1"))).toBe(true)
    expect(urls.some((u) => u.includes("type=all"))).toBe(true)
  })

  it("re-fetches when the steam-data-invalidated event is dispatched", async () => {
    let calls = 0
    mockFetchSequence(async () => {
      calls++
      return ok({ games: [] })
    })
    const { useSteamGames } = await import("@/hooks/use-steam-data")
    const { result } = renderHook(() => useSteamGames("recent"))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const initial = calls
    act(() => {
      window.dispatchEvent(new CustomEvent("steam-data-invalidated"))
    })
    await waitFor(() => expect(calls).toBeGreaterThan(initial))
  })
})

describe("useSteamAchievementsBatch", () => {
  it("returns an empty map for an empty appIds list without calling fetch", async () => {
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    const { useSteamAchievementsBatch } = await import("@/hooks/use-steam-data")
    const { result } = renderHook(() => useSteamAchievementsBatch([]))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.achievementsMap).toEqual({})
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("fetches and maps keyed-by-number achievement entries", async () => {
    mockFetchSequence(async () =>
      ok({
        achievementsMap: {
          "620": [
            {
              apiname: "A",
              achieved: 1,
              unlocktime: 1,
              name: "A",
              description: "",
              displayName: "A",
              icon: "",
              icongray: "",
            },
          ],
          "440": [],
        },
      }),
    )
    const { useSteamAchievementsBatch } = await import("@/hooks/use-steam-data")
    const { result } = renderHook(() => useSteamAchievementsBatch([620, 440]))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.achievementsMap[620]).toHaveLength(1)
    expect(result.current.achievementsMap[440]).toEqual([])
  })

  it("sets error on fetch failure", async () => {
    mockFetchSequence(async () => err(500))
    const { useSteamAchievementsBatch } = await import("@/hooks/use-steam-data")
    const { result } = renderHook(() => useSteamAchievementsBatch([620]))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe("Failed to fetch achievements batch")
  })
})

describe("useSteamStats", () => {
  const sampleStats = {
    totalGames: 10,
    gamesWithAchievements: 5,
    totalAchievements: 20,
    pendingAchievements: 15,
    startedGames: 3,
    averageCompletion: 42,
    totalPlaytime: 100,
    perfectGames: 1,
  }

  it("loads stats on mount", async () => {
    mockFetchSequence(async () => ok(sampleStats))
    const { useSteamStats } = await import("@/hooks/use-steam-data")
    const { result } = renderHook(() => useSteamStats())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.stats?.totalGames).toBe(10)
  })

  it("sets error on 500", async () => {
    mockFetchSequence(async () => err(500))
    const { useSteamStats } = await import("@/hooks/use-steam-data")
    const { result } = renderHook(() => useSteamStats())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe("Failed to fetch stats")
    expect(result.current.stats).toBeNull()
  })

  it("sets error when response shape is invalid", async () => {
    mockFetchSequence(async () => ok({ bogus: true }))
    const { useSteamStats } = await import("@/hooks/use-steam-data")
    const { result } = renderHook(() => useSteamStats())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe("Invalid stats response")
  })

  it("refetch with force appends ?refresh=1", async () => {
    const urls: string[] = []
    mockFetchSequence(async (url) => {
      urls.push(url)
      return ok(sampleStats)
    })
    const { useSteamStats } = await import("@/hooks/use-steam-data")
    const { result } = renderHook(() => useSteamStats())
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.refetch({ force: true })
    })
    expect(urls.some((u) => u.includes("refresh=1"))).toBe(true)
  })
})

describe("useSteamAchievements", () => {
  it("returns empty + loading=false when appId is null", async () => {
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    const { useSteamAchievements } = await import("@/hooks/use-steam-data")
    const { result } = renderHook(() => useSteamAchievements(null))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.achievements).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("loads achievements for a valid appId", async () => {
    mockFetchSequence(async () =>
      ok({
        steamID: "76561198023709299",
        gameName: "Portal 2",
        achievements: [
          {
            apiname: "A",
            achieved: 1,
            unlocktime: 1,
            name: "A",
            description: "",
            displayName: "A",
            icon: "",
            icongray: "",
          },
        ],
        success: true,
      }),
    )
    const { useSteamAchievements } = await import("@/hooks/use-steam-data")
    const { result } = renderHook(() => useSteamAchievements(620))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.achievements).toHaveLength(1)
  })

  it("sets error on non-ok response", async () => {
    mockFetchSequence(async () => err(404))
    const { useSteamAchievements } = await import("@/hooks/use-steam-data")
    const { result } = renderHook(() => useSteamAchievements(620))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe("Failed to fetch achievements")
  })

  it("sets error when response shape is invalid", async () => {
    mockFetchSequence(async () => ok({ bogus: 1 }))
    const { useSteamAchievements } = await import("@/hooks/use-steam-data")
    const { result } = renderHook(() => useSteamAchievements(620))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe("Invalid achievements response")
  })
})
