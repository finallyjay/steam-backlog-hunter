import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// These tests exercise lib/steam-api.ts end-to-end by stubbing the
// global fetch. Every branch of every wrapper is covered here so the
// "Steam changed its response shape" class of bug (bulk endpoint field
// names, localized apinames, silent 400s, etc.) gets caught at CI time
// instead of on a dashboard load.

// steam-api.ts routes all diagnostics through the pino logger, so we mock
// the logger module (rather than spying on console) to assert on its calls.
const { loggerMock } = vi.hoisted(() => ({
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock("@/lib/server/logger", () => ({ logger: loggerMock }))

const ORIGINAL_FETCH = globalThis.fetch

beforeEach(() => {
  process.env.STEAM_API_KEY = "fake-key"
  // Clear here too (not just in afterEach) so a focused run or an inherited
  // shell value can't leak into the default-locale test.
  delete process.env.STEAM_API_LOCALE
  loggerMock.info.mockClear()
  loggerMock.warn.mockClear()
  loggerMock.error.mockClear()
})

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  delete process.env.STEAM_API_KEY
  delete process.env.STEAM_API_LOCALE
  vi.useRealTimers()
  vi.resetModules()
})

type JsonResponse = {
  ok?: boolean
  status?: number
  body?: unknown
  /** Value returned by response.headers.get("retry-after"). */
  retryAfter?: string | null
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
      headers: { get: (name: string) => (name.toLowerCase() === "retry-after" ? (next.retryAfter ?? null) : null) },
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

describe("getSteamPortraitImageUrl", () => {
  it("builds the library portrait url from appid", async () => {
    const { getSteamPortraitImageUrl } = await import("@/lib/steam-api")
    expect(getSteamPortraitImageUrl(620)).toBe(
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/620/library_600x900.jpg",
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
    expect(loggerMock.error).toHaveBeenCalled()
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
    expect(loggerMock.error).toHaveBeenCalled()
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
    expect(loggerMock.error).not.toHaveBeenCalled()
  })

  it("returns null *silently* on 403 (no stats / private)", async () => {
    mockFetchSequence([{ ok: false, status: 403, body: {} }])
    const { getPlayerAchievements } = await import("@/lib/steam-api")
    expect(await getPlayerAchievements("76561198023709299", 620)).toBeNull()
    expect(loggerMock.error).not.toHaveBeenCalled()
  })

  it("throws TransientSteamAPIError on 500 (Steam-side error) instead of returning null", async () => {
    // A 500 says nothing about whether the game has stats — treating it the
    // same as a definitive 400/403 would let a transient Steam-side error
    // get persisted as "no achievements" for up to 7 days. See
    // steam-achievements-sync.ts's getAchievementsForGame.
    mockFetchSequence([{ ok: false, status: 500, body: {} }])
    const { getPlayerAchievements, TransientSteamAPIError } = await import("@/lib/steam-api")
    await expect(getPlayerAchievements("76561198023709299", 620)).rejects.toThrow(TransientSteamAPIError)
    expect(loggerMock.warn).toHaveBeenCalled()
    expect(loggerMock.error).not.toHaveBeenCalled()
  })

  it("throws TransientSteamAPIError on network error (and warns, not errors)", async () => {
    mockFetchRejecting(new Error("socket hangup"))
    const { getPlayerAchievements, TransientSteamAPIError } = await import("@/lib/steam-api")
    await expect(getPlayerAchievements("76561198023709299", 620)).rejects.toThrow(TransientSteamAPIError)
    expect(loggerMock.warn).toHaveBeenCalled()
    expect(loggerMock.error).not.toHaveBeenCalled()
  })

  it("throws TransientSteamAPIError when 429 retries are exhausted", async () => {
    mockFetchSequence([
      { ok: false, status: 429, retryAfter: "0" },
      { ok: false, status: 429, retryAfter: "0" },
      { ok: false, status: 429, retryAfter: "0" },
      { ok: false, status: 429, retryAfter: "0" },
    ])
    const { getPlayerAchievements, TransientSteamAPIError } = await import("@/lib/steam-api")
    vi.useFakeTimers()
    const promise = getPlayerAchievements("76561198023709299", 620)
    // Attach a rejection handler before advancing timers so the eventual
    // rejection is never briefly "unhandled" mid-flight.
    const assertion = expect(promise).rejects.toThrow(TransientSteamAPIError)
    await vi.runAllTimersAsync()
    await assertion
    expect(loggerMock.error).toHaveBeenCalled()
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
    expect(loggerMock.error).not.toHaveBeenCalled()
  })

  it("returns null silently on 403", async () => {
    mockFetchSequence([{ ok: false, status: 403, body: {} }])
    const { getGameSchema } = await import("@/lib/steam-api")
    expect(await getGameSchema(620)).toBeNull()
    expect(loggerMock.error).not.toHaveBeenCalled()
  })

  it("logs on 500 and returns null", async () => {
    mockFetchSequence([{ ok: false, status: 500, body: {} }])
    const { getGameSchema } = await import("@/lib/steam-api")
    expect(await getGameSchema(620)).toBeNull()
    expect(loggerMock.error).toHaveBeenCalled()
  })

  it("logs on network error and returns null", async () => {
    mockFetchRejecting(new Error("DNS failure"))
    const { getGameSchema } = await import("@/lib/steam-api")
    expect(await getGameSchema(620)).toBeNull()
    expect(loggerMock.error).toHaveBeenCalled()
  })
})

describe("locale configuration (STEAM_API_LOCALE)", () => {
  it("defaults to l=es when STEAM_API_LOCALE is unset", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ response: { games: [] } }),
    })) as unknown as typeof fetch
    globalThis.fetch = fetchMock
    const { getOwnedGames } = await import("@/lib/steam-api")
    await getOwnedGames("76561198023709299")
    const url = (fetchMock as unknown as { mock: { calls: [[string, unknown]] } }).mock.calls[0][0]
    expect(url).toContain("l=es")
  })

  it("uses the STEAM_API_LOCALE override when set", async () => {
    process.env.STEAM_API_LOCALE = "en"
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ response: { games: [] } }),
    })) as unknown as typeof fetch
    globalThis.fetch = fetchMock
    const { getOwnedGames } = await import("@/lib/steam-api")
    await getOwnedGames("76561198023709299")
    const url = (fetchMock as unknown as { mock: { calls: [[string, unknown]] } }).mock.calls[0][0]
    expect(url).toContain("l=en")
    expect(url).not.toContain("l=es")
  })
})

describe("429 rate-limit backoff", () => {
  it("retries after a 429 and succeeds on the follow-up request", async () => {
    mockFetchSequence([
      { ok: false, status: 429, retryAfter: "0" },
      { body: { response: { games: [{ appid: 620, name: "Portal 2", playtime_forever: 1 }] } } },
    ])
    const { getOwnedGames } = await import("@/lib/steam-api")
    vi.useFakeTimers()
    const promise = getOwnedGames("76561198023709299")
    await vi.runAllTimersAsync()
    const games = await promise
    expect(games).toHaveLength(1)
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    expect(loggerMock.warn).toHaveBeenCalled()
    expect(loggerMock.error).not.toHaveBeenCalled()
  })

  it("honours the Retry-After header when computing the backoff delay", async () => {
    mockFetchSequence([{ ok: false, status: 429, retryAfter: "2" }, { body: { response: { games: [] } } }])
    const { getOwnedGames } = await import("@/lib/steam-api")
    vi.useFakeTimers()
    const promise = getOwnedGames("76561198023709299")
    await vi.runAllTimersAsync()
    await promise
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ delayMs: 2000, retryAfter: "2" }),
      expect.any(String),
    )
  })

  it("honours a Retry-After larger than the exponential cap WITHOUT capping it to MAX_BACKOFF", async () => {
    // 45s Retry-After is > the 30s exponential cap but <= the 60s wait ceiling:
    // it must be waited out in full, not truncated to 30s (which would retry
    // while Steam is still throttling).
    mockFetchSequence([{ ok: false, status: 429, retryAfter: "45" }, { body: { response: { games: [] } } }])
    const { getOwnedGames } = await import("@/lib/steam-api")
    vi.useFakeTimers()
    const promise = getOwnedGames("76561198023709299")
    await vi.runAllTimersAsync()
    await promise
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ delayMs: 45000, retryAfter: "45" }),
      expect.any(String),
    )
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })

  it("gives up immediately (no early retry) when Retry-After exceeds the wait ceiling", async () => {
    // 120s > the 60s ceiling: retrying before that window closes would just
    // hit the same throttle, so we fail fast instead of retrying too soon.
    mockFetchSequence([{ ok: false, status: 429, retryAfter: "120" }])
    const { getOwnedGames } = await import("@/lib/steam-api")
    const games = await getOwnedGames("76561198023709299")
    expect(games).toEqual([])
    // Only the initial request — no retry was attempted.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(loggerMock.warn).not.toHaveBeenCalled()
    expect(loggerMock.error).toHaveBeenCalled()
  })

  it("gives up after exhausting retries and returns the empty fallback", async () => {
    mockFetchSequence([
      { ok: false, status: 429, retryAfter: "0" },
      { ok: false, status: 429, retryAfter: "0" },
      { ok: false, status: 429, retryAfter: "0" },
      { ok: false, status: 429, retryAfter: "0" },
    ])
    const { getOwnedGames } = await import("@/lib/steam-api")
    vi.useFakeTimers()
    const promise = getOwnedGames("76561198023709299")
    await vi.runAllTimersAsync()
    const games = await promise
    expect(games).toEqual([])
    // 1 initial + 3 retries
    expect(globalThis.fetch).toHaveBeenCalledTimes(4)
    expect(loggerMock.error).toHaveBeenCalled()
  })

  it("falls back to exponential backoff when no Retry-After header is present", async () => {
    mockFetchSequence([{ ok: false, status: 429, retryAfter: null }, { body: { response: { games: [] } } }])
    const { getOwnedGames } = await import("@/lib/steam-api")
    vi.useFakeTimers()
    const promise = getOwnedGames("76561198023709299")
    await vi.runAllTimersAsync()
    await promise
    // attempt 0 → BASE_BACKOFF_MS * 2**0 = 1000ms
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ delayMs: 1000, retryAfter: null }),
      expect.any(String),
    )
  })

  describe("cumulative retry budget (MAX_TOTAL_RETRY_WAIT_MS)", () => {
    it("cuts off retries once the accumulated wait would exceed the total budget, even though each Retry-After is within the per-attempt ceiling", async () => {
      // Two 40s waits are each within the 60s per-attempt ceiling, but back
      // to back they'd total 80s — over the 60s cumulative budget — so the
      // second retry must give up instead of sleeping again.
      mockFetchSequence([
        { ok: false, status: 429, retryAfter: "40" },
        { ok: false, status: 429, retryAfter: "40" },
      ])
      const { getOwnedGames } = await import("@/lib/steam-api")
      vi.useFakeTimers()
      const promise = getOwnedGames("76561198023709299")
      await vi.runAllTimersAsync()
      const games = await promise
      expect(games).toEqual([])
      // Initial request + one retry the budget still allowed; the second 429
      // is answered by giving up rather than a third fetch.
      expect(globalThis.fetch).toHaveBeenCalledTimes(2)
      expect(loggerMock.warn).toHaveBeenCalledTimes(1)
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ retryAfter: "40" }),
        expect.stringContaining("giving up"),
      )
    })

    it("still retries normally while the accumulated wait stays within the total budget", async () => {
      // Two 20s waits total 40s, under the 60s cumulative budget, so both
      // retries proceed exactly like before this change.
      mockFetchSequence([
        { ok: false, status: 429, retryAfter: "20" },
        { ok: false, status: 429, retryAfter: "20" },
        { body: { response: { games: [{ appid: 620, name: "Portal 2", playtime_forever: 1 }] } } },
      ])
      const { getOwnedGames } = await import("@/lib/steam-api")
      vi.useFakeTimers()
      const promise = getOwnedGames("76561198023709299")
      await vi.runAllTimersAsync()
      const games = await promise
      expect(games).toHaveLength(1)
      expect(globalThis.fetch).toHaveBeenCalledTimes(3)
      expect(loggerMock.warn).toHaveBeenCalledTimes(2)
      expect(loggerMock.error).not.toHaveBeenCalled()
    })

    it("allows a single wait exactly equal to the total budget (only 'exceeds' cuts off, not 'meets')", async () => {
      mockFetchSequence([{ ok: false, status: 429, retryAfter: "60" }, { body: { response: { games: [] } } }])
      const { getOwnedGames } = await import("@/lib/steam-api")
      vi.useFakeTimers()
      const promise = getOwnedGames("76561198023709299")
      await vi.runAllTimersAsync()
      await promise
      expect(globalThis.fetch).toHaveBeenCalledTimes(2)
      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({ delayMs: 60000, retryAfter: "60" }),
        expect.any(String),
      )
      expect(loggerMock.error).not.toHaveBeenCalled()
    })
  })
})
