import { afterEach, describe, expect, it, vi } from "vitest"

import { __resetAllowedGamesClientCache, getAllowedGameIdsClient, parseAllowedGameIds } from "@/lib/allowed-games"

describe("allowed games helpers", () => {
  afterEach(() => {
    __resetAllowedGamesClientCache()
    vi.restoreAllMocks()
  })

  it("parses allowed game ids as a string set", () => {
    const ids = parseAllowedGameIds([
      { id: 10, name: "Counter-Strike" },
      { id: 730, name: "CS2" },
    ])

    expect(ids.has("10")).toBe(true)
    expect(ids.has("730")).toBe(true)
    expect(ids.size).toBe(2)
  })

  it("caches client fetch result", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: 730, name: "CS2" }],
    })

    vi.stubGlobal("fetch", fetchMock)

    const first = await getAllowedGameIdsClient()
    const second = await getAllowedGameIdsClient()

    expect(first.has("730")).toBe(true)
    expect(second.has("730")).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
