export interface SteamGame {
  appid: number
  name: string
  playtime_forever: number
  playtime_2weeks?: number
  img_icon_url: string
  img_logo_url: string
  has_community_visible_stats?: boolean
}

export interface SteamAchievement {
  apiname: string
  achieved: number
  unlocktime: number
  name?: string
  description?: string
}

export interface GameAchievements {
  steamID: string
  gameName: string
  achievements: SteamAchievement[]
  success: boolean
}

export interface PlayerStats {
  steamID: string
  gameName: string
  achievements: SteamAchievement[]
  stats: Array<{
    name: string
    value: number
  }>
  success: boolean
}

const STEAM_API_BASE = "https://api.steampowered.com"

class SteamAPIError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message)
    this.name = "SteamAPIError"
  }
}

async function steamAPIRequest(endpoint: string, params: Record<string, string>) {
  const apiKey = process.env.STEAM_API_KEY
  if (!apiKey) {
    throw new SteamAPIError("Steam API key not configured")
  }

  const url = new URL(`${STEAM_API_BASE}${endpoint}`)
  url.searchParams.set("key", apiKey)
  url.searchParams.set("format", "json")

  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value)
  })

  try {
    const response = await fetch(url.toString(), {
      next: { revalidate: 300 }, // Cache for 5 minutes
    })

    if (!response.ok) {
      throw new SteamAPIError(`Steam API request failed: ${response.status}`, response.status)
    }

    return await response.json()
  } catch (error) {
    if (error instanceof SteamAPIError) {
      throw error
    }
    throw new SteamAPIError(`Network error: ${error instanceof Error ? error.message : "Unknown error"}`)
  }
}

export async function getOwnedGames(steamId: string): Promise<SteamGame[]> {
  try {
    const data = await steamAPIRequest("/IPlayerService/GetOwnedGames/v0001/", {
      steamid: steamId,
      include_appinfo: "1",
      include_played_free_games: "1",
    })

    return data.response?.games || []
  } catch (error) {
    console.error("Error fetching owned games:", error)
    return []
  }
}

export async function getRecentlyPlayedGames(steamId: string): Promise<SteamGame[]> {
  try {
    const data = await steamAPIRequest("/IPlayerService/GetRecentlyPlayedGames/v0001/", {
      steamid: steamId,
      count: "10",
    })

    return data.response?.games || []
  } catch (error) {
    console.error("Error fetching recently played games:", error)
    return []
  }
}

export async function getPlayerAchievements(steamId: string, appId: number): Promise<GameAchievements | null> {
  try {
    const data = await steamAPIRequest("/ISteamUserStats/GetPlayerAchievements/v0001/", {
      steamid: steamId,
      appid: appId.toString(),
      l: "english",
    })

    if (!data.playerstats?.success) {
      return null
    }

    return {
      steamID: data.playerstats.steamID,
      gameName: data.playerstats.gameName,
      achievements: data.playerstats.achievements || [],
      success: data.playerstats.success,
    }
  } catch (error) {
    console.error(`Error fetching achievements for app ${appId}:`, error)
    return null
  }
}

export async function getGameSchema(appId: number): Promise<any> {
  try {
    const data = await steamAPIRequest("/ISteamUserStats/GetSchemaForGame/v2/", {
      appid: appId.toString(),
    })

    return data.game || null
  } catch (error) {
    console.error(`Error fetching game schema for app ${appId}:`, error)
    return null
  }
}

export async function getUserStats(steamId: string): Promise<{
  totalGames: number
  totalAchievements: number
  totalPlaytime: number
  perfectGames: number
}> {
  try {
    const games = await getOwnedGames(steamId)

    let totalAchievements = 0
    let perfectGames = 0

    // Get achievement counts for a sample of games (to avoid rate limiting)
    const sampleGames = games.slice(0, 10).filter((game) => game.has_community_visible_stats)

    for (const game of sampleGames) {
      const achievements = await getPlayerAchievements(steamId, game.appid)
      if (achievements) {
        const unlockedCount = achievements.achievements.filter((a) => a.achieved === 1).length
        totalAchievements += unlockedCount

        if (unlockedCount === achievements.achievements.length && achievements.achievements.length > 0) {
          perfectGames++
        }
      }
    }

    const totalPlaytime = games.reduce((sum, game) => sum + game.playtime_forever, 0)

    return {
      totalGames: games.length,
      totalAchievements,
      totalPlaytime: Math.round(totalPlaytime / 60), // Convert to hours
      perfectGames,
    }
  } catch (error) {
    console.error("Error fetching user stats:", error)
    return {
      totalGames: 0,
      totalAchievements: 0,
      totalPlaytime: 0,
      perfectGames: 0,
    }
  }
}

export function getSteamImageUrl(appId: number, imageHash: string, type: "icon" | "logo" = "icon"): string {
  if (!imageHash) return "/placeholder.svg"

  const size = type === "icon" ? "32x32" : "184x69"
  return `https://media.steampowered.com/steamcommunity/public/images/apps/${appId}/${imageHash}.jpg`
}
