import type { SteamGame } from "@/lib/steam-api"
import type { SteamAchievementView, SteamGameCardModel } from "@/lib/types/steam"

type GamesOrder = "completed" | "alphabetical" | "achievementsAsc" | "achievementsDesc"

type GameBase = {
  id: number
  name: string
  image: string
  playtime: number
}

/**
 * Maps raw SteamGame objects to simplified game card models.
 *
 * @param allowedIds - Optional set of app IDs to filter by (shows all if omitted)
 */
export function mapOwnedGamesToGameCards(
  games: SteamGame[],
  getImageUrl: (appId: number, imageHash: string) => string,
  allowedIds?: Set<string>,
): GameBase[] {
  return games
    .filter((game) => (allowedIds ? allowedIds.has(String(game.appid)) : true))
    .map((game) => ({
      id: game.appid,
      name: game.name,
      image: game.image_landscape_url || getImageUrl(game.appid, game.img_icon_url),
      playtime: Number((game.playtime_forever / 60).toFixed(1)),
    }))
}

/** Attaches achievement stats (percent, completed, total) to game card models. */
export function buildGamesWithStats(
  games: GameBase[],
  achievementsMap: Record<number, SteamAchievementView[]>,
): SteamGameCardModel[] {
  return games.map((game) => {
    const achievements = achievementsMap[game.id] || []
    const unlocked = achievements.filter((achievement) => achievement.achieved === 1).length
    const total = achievements.length
    const percent = total > 0 ? Math.round((unlocked / total) * 100) : 0
    const completed = total > 0 && unlocked === total

    return {
      ...game,
      achievements,
      percent,
      completed,
      totalAchievements: total,
    }
  })
}

/** Sorts game cards by the given ordering (completed, alphabetical, achievements asc/desc). */
export function sortGames(games: SteamGameCardModel[], order: GamesOrder): SteamGameCardModel[] {
  const sortedGames = [...games]

  switch (order) {
    case "alphabetical":
      return sortedGames.sort((a, b) => a.name.localeCompare(b.name))
    case "achievementsAsc":
      return sortedGames.sort((a, b) => a.totalAchievements - b.totalAchievements)
    case "achievementsDesc":
      return sortedGames.sort((a, b) => b.totalAchievements - a.totalAchievements)
    case "completed":
    default:
      return sortedGames.sort((a, b) => {
        if (a.completed !== b.completed) return Number(b.completed) - Number(a.completed)
        return b.percent - a.percent
      })
  }
}

/** Filters out completed games unless showCompleted is true. */
export function filterVisibleGames(games: SteamGameCardModel[], showCompleted: boolean): SteamGameCardModel[] {
  if (showCompleted) {
    return games
  }
  return games.filter((game) => !game.completed)
}
