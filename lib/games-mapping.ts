import type { SteamGame } from "@/lib/steam-api"
import type { SteamAchievementView, SteamGameCardModel } from "@/lib/types/steam"

type GamesOrder = "completed" | "alphabetical" | "achievementsAsc" | "achievementsDesc"

type GameBase = {
  id: number
  name: string
  image: string
  imagePortrait?: string | null
  playtime: number
  unlocked_count: number
  total_count: number
  perfect_game: boolean
  platforms?: { windows: boolean; mac: boolean; linux: boolean } | null
  releaseYear?: number | null
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
      imagePortrait: game.image_portrait_url ?? null,
      playtime: Number((game.playtime_forever / 60).toFixed(1)),
      unlocked_count: game.unlocked_count ?? 0,
      total_count: game.total_count ?? 0,
      perfect_game: game.perfect_game ?? false,
      platforms: game.platforms ?? null,
      releaseYear: game.releaseYear ?? null,
    }))
}

/** Attaches achievement stats (percent, completed, total) to game card models. */
export function buildGamesWithStats(
  games: GameBase[],
  achievementsMap: Record<number, SteamAchievementView[]>,
): SteamGameCardModel[] {
  return games.map((game) => {
    const achievements = achievementsMap[game.id] || []
    // Use server-side stats (from DB) as source of truth for filtering,
    // fall back to achievementsMap only for the detailed achievement list
    const total = game.total_count > 0 ? game.total_count : achievements.length
    const unlocked = game.unlocked_count > 0 ? game.unlocked_count : achievements.filter((a) => a.achieved === 1).length
    const percent = total > 0 ? Math.round((unlocked / total) * 100) : 0
    const completed = game.perfect_game || (total > 0 && unlocked === total)

    return {
      ...game,
      achievements,
      percent,
      completed,
      totalAchievements: total,
      unlockedAchievements: unlocked,
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
