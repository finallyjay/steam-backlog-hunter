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
      (appId, hash) => `/img/${appId}/${hash}`,
      new Set(["730"]),
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
        { id: 1, name: "A", image: "a", playtime: 1, unlocked_count: 0, total_count: 0, perfect_game: false },
        { id: 2, name: "B", image: "b", playtime: 1, unlocked_count: 0, total_count: 0, perfect_game: false },
      ],
      {
        1: [
          {
            apiname: "x",
            achieved: 1,
            unlocktime: 1,
            displayName: "x",
            description: "",
            icon: "",
            icongray: "",
            hidden: 0,
            globalPercent: null,
          },
        ],
        2: [
          {
            apiname: "y",
            achieved: 0,
            unlocktime: 0,
            displayName: "y",
            description: "",
            icon: "",
            icongray: "",
            hidden: 0,
            globalPercent: null,
          },
        ],
      },
    )

    const sorted = sortGames(gamesWithStats, "completed")

    expect(sorted[0].id).toBe(1)
    expect(sorted[0].completed).toBe(true)
    expect(filterVisibleGames(sorted, false)).toHaveLength(1)
  })

  it("filterVisibleGames with showCompleted=true returns all games", () => {
    const games = buildGamesWithStats(
      [
        { id: 1, name: "A", image: "a", playtime: 1, unlocked_count: 0, total_count: 0, perfect_game: false },
        { id: 2, name: "B", image: "b", playtime: 1, unlocked_count: 0, total_count: 0, perfect_game: false },
      ],
      {
        1: [
          {
            apiname: "x",
            achieved: 1,
            unlocktime: 1,
            displayName: "x",
            description: "",
            icon: "",
            icongray: "",
            hidden: 0,
            globalPercent: null,
          },
        ],
        2: [
          {
            apiname: "y",
            achieved: 0,
            unlocktime: 0,
            displayName: "y",
            description: "",
            icon: "",
            icongray: "",
            hidden: 0,
            globalPercent: null,
          },
        ],
      },
    )

    const result = filterVisibleGames(games, true)
    expect(result).toHaveLength(2)
  })

  it("sortGames with alphabetical sorts by name", () => {
    const games = buildGamesWithStats(
      [
        { id: 1, name: "Zelda", image: "z", playtime: 1, unlocked_count: 0, total_count: 0, perfect_game: false },
        { id: 2, name: "Alpha", image: "a", playtime: 1, unlocked_count: 0, total_count: 0, perfect_game: false },
        { id: 3, name: "Mario", image: "m", playtime: 1, unlocked_count: 0, total_count: 0, perfect_game: false },
      ],
      {},
    )

    const sorted = sortGames(games, "alphabetical")
    expect(sorted.map((g) => g.name)).toEqual(["Alpha", "Mario", "Zelda"])
  })

  it("sortGames with achievementsDesc sorts by achievement count", () => {
    const games = buildGamesWithStats(
      [
        { id: 1, name: "A", image: "a", playtime: 1, unlocked_count: 0, total_count: 0, perfect_game: false },
        { id: 2, name: "B", image: "b", playtime: 1, unlocked_count: 0, total_count: 0, perfect_game: false },
        { id: 3, name: "C", image: "c", playtime: 1, unlocked_count: 0, total_count: 0, perfect_game: false },
      ],
      {
        1: [
          {
            apiname: "x",
            achieved: 0,
            unlocktime: 0,
            displayName: "x",
            description: "",
            icon: "",
            icongray: "",
            hidden: 0,
            globalPercent: null,
          },
        ],
        2: [
          {
            apiname: "y",
            achieved: 0,
            unlocktime: 0,
            displayName: "y",
            description: "",
            icon: "",
            icongray: "",
            hidden: 0,
            globalPercent: null,
          },
          {
            apiname: "z",
            achieved: 0,
            unlocktime: 0,
            displayName: "z",
            description: "",
            icon: "",
            icongray: "",
            hidden: 0,
            globalPercent: null,
          },
          {
            apiname: "w",
            achieved: 0,
            unlocktime: 0,
            displayName: "w",
            description: "",
            icon: "",
            icongray: "",
            hidden: 0,
            globalPercent: null,
          },
        ],
        3: [
          {
            apiname: "a",
            achieved: 0,
            unlocktime: 0,
            displayName: "a",
            description: "",
            icon: "",
            icongray: "",
            hidden: 0,
            globalPercent: null,
          },
          {
            apiname: "b",
            achieved: 0,
            unlocktime: 0,
            displayName: "b",
            description: "",
            icon: "",
            icongray: "",
            hidden: 0,
            globalPercent: null,
          },
        ],
      },
    )

    const sorted = sortGames(games, "achievementsDesc")
    expect(sorted.map((g) => g.totalAchievements)).toEqual([3, 2, 1])
  })
})
