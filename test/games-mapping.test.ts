import { describe, expect, it } from "vitest"

import { buildGamesWithStats, filterVisibleGames, mapOwnedGamesToGameCards, sortGames } from "@/lib/games-mapping"

describe("games mapping", () => {
  it("maps owned games to cards using allowed ids", () => {
    const cards = mapOwnedGamesToGameCards(
      [
        {
          appid: 730,
          name: "CS2",
          playtime_forever: 120,
          img_icon_url: "iconhash",
          img_logo_url: "logo",
        },
        {
          appid: 440,
          name: "TF2",
          playtime_forever: 60,
          img_icon_url: "iconhash2",
          img_logo_url: "logo2",
        },
      ],
      new Set(["730"]),
      (appId, hash) => `/img/${appId}/${hash}`,
    )

    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      id: 730,
      name: "CS2",
      playtime: 2,
      image: "/img/730/iconhash",
    })
  })

  it("builds stats and sorts by completion", () => {
    const gamesWithStats = buildGamesWithStats(
      [
        { id: 1, name: "A", image: "a", playtime: 1 },
        { id: 2, name: "B", image: "b", playtime: 1 },
      ],
      {
        1: [
          { apiname: "x", achieved: 1, unlocktime: 1, displayName: "x", description: "", icon: "", icongray: "" },
        ],
        2: [
          { apiname: "y", achieved: 0, unlocktime: 0, displayName: "y", description: "", icon: "", icongray: "" },
        ],
      },
    )

    const sorted = sortGames(gamesWithStats, "completed")

    expect(sorted[0].id).toBe(1)
    expect(sorted[0].completed).toBe(true)
    expect(filterVisibleGames(sorted, false)).toHaveLength(1)
  })
})
