import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// These tests exercise lib/steam-api.ts end-to-end by stubbing the
// global fetch. Every branch of every wrapper is covered here so the
// "Steam changed its response shape" class of bug (bulk endpoint field
// names, localized apinames, silent 400s, etc.) gets caught at CI time
// instead of on a dashboard load.

const ORIGINAL_FETCH = globalThis.fetch
const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

beforeEach(() => {
  process.env.STEAM_API_KEY = "fake-key"
  consoleErrorSpy.mockClear()
})

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  delete process.env.STEAM_API_KEY
  vi.resetModules()
})

type JsonResponse = {
  ok?: boolean
  status?: number
  body?: unknown
}

/** Queues fetch responses in order; the wrapper always calls fetch once per request. */
function mockFetchSequence(responses: JsonResponse[]) {
  const queue = [...responses]
  globalThis.fetch = vi.fn(async () => {
    const next = queue.shift()
    if (!next) throw new Error("unexpected extra fetch call")
    return {
      ok: next.ok ?? true,
      status: next.status ?? 200,
      json: async () => next.body,
    } as unknown as Response
  }) as unknown as typeof fetch
}

function mockFetchRejecting(error: Error) {
  globalThis.fetch = vi.fn(async () => {
    throw error
  }) as unknown as typeof fetch
}

describe("getSteamImageUrl", () => {
  it("returns placeholder when imageHash is empty", async () => {
    const { getSteamImageUrl } = await import("@/lib/steam-api")
    expect(getSteamImageUrl(620, "")).toBe("/placeholder-icon.svg")
  })

  it("builds the community CDN url from appid and hash", async () => {
    const { getSteamImageUrl } = await import("@/lib/steam-api")
    expect(getSteamImageUrl(620, "abc123")).toBe(
      "https://media.steampowered.com/steamcommunity/public/images/apps/620/abc123.jpg",
    )
  })
})

describe("getSteamHeaderImageUrl", () => {
  it("builds the store header url from appid", async () => {
    const { getSteamHeaderImageUrl } = await import("@/lib/steam-api")
    expect(getSteamHeaderImageUrl(620)).toBe(
      "https://shared.steamstatic.com/store_item_assets/steam/apps/620/header.jpg",
    )
  })
})

describe("getOwnedGames", () => {
  it("returns the games array on a successful response", async () => {
    mockFetchSequence([
      {
        body: {
          response: {
            games: [
              { appid: 620, name: "Portal 2", playtime_forever: 100 },
              { appid: 440, name: "TF2", playtime_forever: 200 },
            ],
          },
        },
      },
    ])
    const { getOwnedGames } = await import("@/lib/steam-api")
    const games = await getOwnedGames("76561198023709299")
    expect(games).toHaveLength(2)
    expect(games[0]?.appid).toBe(620)
  })

  it("passes the expected query parameters (skip_unvetted_apps=0, include_played_free_games, include_appinfo)", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ response: { games: [] } }),
    })) as unknown as typeof fetch
    globalThis.fetch = fetchMock
    const { getOwnedGames } = await import("@/lib/steam-api")
    await getOwnedGames("76561198023709299")
    const calledWith = (fetchMock as unknown as { mock: { calls: [[string, unknown]] } }).mock.calls[0][0]
    expect(calledWith).toContain("skip_unvetted_apps=0")
    expect(calledWith).toContain("include_played_free_games=1")
    expect(calledWith).toContain("include_appinfo=1")
    expect(calledWith).toContain("steamid=76561198023709299")
  })

  it("returns an empty array when fetch rejects", async () => {
    mockFetchRejecting(new Error("ECONNREFUSED"))
    const { getOwnedGames } = await import("@/lib/steam-api")
    expect(await getOwnedGames("76561198023709299")).toEqual([])
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  it("returns an empty array when the response body has no games field", async () => {
    mockFetchSequence([{ body: { response: {} } }])
    const { getOwnedGames } = await import("@/lib/steam-api")
    expect(await getOwnedGames("76561198023709299")).toEqual([])
  })

  it("throws and is caught when STEAM_API_KEY is missing", async () => {
    delete process.env.STEAM_API_KEY
    mockFetchSequence([{ body: {} }]) // unused
    const { getOwnedGames } = await import("@/lib/steam-api")
    expect(await getOwnedGames("76561198023709299")).toEqual([])
    expect(consoleErrorSpy).toHaveBeenCalled()
  })
})

describe("getRecentlyPlayedGames", () => {
  it("returns the games array on success", async () => {
    mockFetchSequence([{ body: { response: { games: [{ appid: 620, name: "Portal 2", playtime_forever: 0 }] } } }])
    const { getRecentlyPlayedGames } = await import("@/lib/steam-api")
    const games = await getRecentlyPlayedGames("76561198023709299")
    expect(games).toHaveLength(1)
  })

  it("passes count=25 as a query parameter", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ response: { games: [] } }),
    })) as unknown as typeof fetch
    globalThis.fetch = fetchMock
    const { getRecentlyPlayedGames } = await import("@/lib/steam-api")
    await getRecentlyPlayedGames("76561198023709299")
    const url = (fetchMock as unknown as { mock: { calls: [[string, unknown]] } }).mock.calls[0][0]
    expect(url).toContain("count=25")
  })

  it("returns an empty array on network failure", async () => {
    mockFetchRejecting(new Error("EHOSTUNREACH"))
    const { getRecentlyPlayedGames } = await import("@/lib/steam-api")
    expect(await getRecentlyPlayedGames("76561198023709299")).toEqual([])
    expect(consoleErrorSpy).toHaveBeenCalled()
  })
})

describe("getPlayerAchievements", () => {
  it("returns the enriched achievements payload on success", async () => {
    mockFetchSequence([
      {
        body: {
          playerstats: {
            steamID: "76561198023709299",
            gameName: "Portal 2",
            success: true,
            achievements: [
              { apiname: "ACH_ONE", achieved: 1, unlocktime: 1700000000 },
              { apiname: "ACH_TWO", achieved: 0, unlocktime: 0 },
            ],
          },
        },
      },
    ])
    const { getPlayerAchievements } = await import("@/lib/steam-api")
    const result = await getPlayerAchievements("76561198023709299", 620)
    expect(result).not.toBeNull()
    expect(result?.gameName).toBe("Portal 2")
    expect(result?.achievements).toHaveLength(2)
    expect(result?.success).toBe(true)
  })

  it("returns null when playerstats.success is false", async () => {
    mockFetchSequence([{ body: { playerstats: { success: false } } }])
    const { getPlayerAchievements } = await import("@/lib/steam-api")
    expect(await getPlayerAchievements("76561198023709299", 620)).toBeNull()
  })

  it("returns null *silently* on 400 (no stats available) — no console noise", async () => {
    mockFetchSequence([{ ok: false, status: 400, body: { playerstats: { error: "Requested app has no stats" } } }])
    const { getPlayerAchievements } = await import("@/lib/steam-api")
    expect(await getPlayerAchievements("76561198023709299", 620)).toBeNull()
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it("returns null *silently* on 403 (no stats / private)", async () => {
    mockFetchSequence([{ ok: false, status: 403, body: {} }])
    const { getPlayerAchievements } = await import("@/lib/steam-api")
    expect(await getPlayerAchievements("76561198023709299", 620)).toBeNull()
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it("logs an error and returns null on 500", async () => {
    mockFetchSequence([{ ok: false, status: 500, body: {} }])
    const { getPlayerAchievements } = await import("@/lib/steam-api")
    expect(await getPlayerAchievements("76561198023709299", 620)).toBeNull()
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  it("returns null on network error", async () => {
    mockFetchRejecting(new Error("socket hangup"))
    const { getPlayerAchievements } = await import("@/lib/steam-api")
    expect(await getPlayerAchievements("76561198023709299", 620)).toBeNull()
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  it("defaults achievements to [] when the response omits the array", async () => {
    mockFetchSequence([
      {
        body: {
          playerstats: {
            steamID: "76561198023709299",
            gameName: "Broken",
            success: true,
          },
        },
      },
    ])
    const { getPlayerAchievements } = await import("@/lib/steam-api")
    const result = await getPlayerAchievements("76561198023709299", 620)
    expect(result?.achievements).toEqual([])
  })
})

describe("getGameSchema", () => {
  it("returns the game field from the response on success", async () => {
    mockFetchSequence([
      { body: { game: { gameName: "Portal 2", availableGameStats: { achievements: [{ name: "ACH_ONE" }] } } } },
    ])
    const { getGameSchema } = await import("@/lib/steam-api")
    const schema = (await getGameSchema(620)) as { gameName: string } | null
    expect(schema?.gameName).toBe("Portal 2")
  })

  it("returns null when the response body has no game field", async () => {
    mockFetchSequence([{ body: {} }])
    const { getGameSchema } = await import("@/lib/steam-api")
    expect(await getGameSchema(620)).toBeNull()
  })

  it("returns null silently on 400", async () => {
    mockFetchSequence([{ ok: false, status: 400, body: {} }])
    const { getGameSchema } = await import("@/lib/steam-api")
    expect(await getGameSchema(620)).toBeNull()
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it("returns null silently on 403", async () => {
    mockFetchSequence([{ ok: false, status: 403, body: {} }])
    const { getGameSchema } = await import("@/lib/steam-api")
    expect(await getGameSchema(620)).toBeNull()
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it("logs on 500 and returns null", async () => {
    mockFetchSequence([{ ok: false, status: 500, body: {} }])
    const { getGameSchema } = await import("@/lib/steam-api")
    expect(await getGameSchema(620)).toBeNull()
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  it("logs on network error and returns null", async () => {
    mockFetchRejecting(new Error("DNS failure"))
    const { getGameSchema } = await import("@/lib/steam-api")
    expect(await getGameSchema(620)).toBeNull()
    expect(consoleErrorSpy).toHaveBeenCalled()
  })
})
