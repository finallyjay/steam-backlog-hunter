export interface SteamGame {
  appid: number
  name: string
  playtime_forever: number
  playtime_2weeks?: number
  img_icon_url: string
  img_logo_url: string
  image_icon_url?: string
  image_landscape_url?: string
  image_portrait_url?: string
  rtime_last_played?: number
  has_community_visible_stats?: boolean
  unlocked_count?: number
  total_count?: number
  perfect_game?: boolean
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
    throw new SteamAPIError("STEAM_API_KEY is not configured", 500)
  }

  const url = new URL(`${STEAM_API_BASE}${endpoint}`)
  url.searchParams.set("key", apiKey)
  url.searchParams.set("format", "json")

  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value)
  })

  try {
    const response = await fetch(url.toString(), {
      cache: "no-store",
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

/** Fetches all owned games (including free-to-play) for a Steam user. */
export async function getOwnedGames(steamId: string): Promise<SteamGame[]> {
  try {
    const data = await steamAPIRequest("/IPlayerService/GetOwnedGames/v1/", {
      steamid: steamId,
      include_appinfo: "1",
      include_played_free_games: "1",
      l: "es",
    })

    return data.response?.games || []
  } catch (error) {
    console.error("Error fetching owned games:", error)
    return []
  }
}

/** Fetches the 25 most recently played games for a Steam user. */
export async function getRecentlyPlayedGames(steamId: string): Promise<SteamGame[]> {
  try {
    const data = await steamAPIRequest("/IPlayerService/GetRecentlyPlayedGames/v1/", {
      steamid: steamId,
      count: "25",
      l: "es",
    })

    return data.response?.games || []
  } catch (error) {
    console.error("Error fetching recently played games:", error)
    return []
  }
}

/** Fetches a player's achievements for a specific game, or null if unavailable. */
export async function getPlayerAchievements(steamId: string, appId: number): Promise<GameAchievements | null> {
  try {
    const data = await steamAPIRequest("/ISteamUserStats/GetPlayerAchievements/v1/", {
      steamid: steamId,
      appid: appId.toString(),
      l: "es",
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
    // Steam returns 400/403 for games that simply don't publish stats (very
    // common for older titles, DLC-only entries, stats-only games, etc).
    // That's the signal the caller expects — a null return value — so don't
    // spam the console with "errors" for the normal case.
    if (error instanceof SteamAPIError && (error.status === 400 || error.status === 403)) {
      return null
    }
    console.error("Error fetching achievements for app:", appId, error)
    return null
  }
}

/** Fetches the game schema (achievement and stat definitions) from the Steam API. */
export async function getGameSchema(appId: number): Promise<unknown> {
  try {
    const data = await steamAPIRequest("/ISteamUserStats/GetSchemaForGame/v2/", {
      appid: appId.toString(),
    })

    return data.game || null
  } catch (error) {
    // Same story as getPlayerAchievements: 400/403 just means the app has no
    // publishable schema. Let the caller treat it as an empty schema without
    // lighting up the console.
    if (error instanceof SteamAPIError && (error.status === 400 || error.status === 403)) {
      return null
    }
    console.error("Error fetching game schema for app:", appId, error)
    return null
  }
}

/** Builds a Steam community image URL from an app ID and image hash. */
export function getSteamImageUrl(appId: number, imageHash: string): string {
  if (!imageHash) return "/placeholder-icon.svg"

  return `https://media.steampowered.com/steamcommunity/public/images/apps/${appId}/${imageHash}.jpg`
}

/** Builds a Steam store header image URL for a game. */
export function getSteamHeaderImageUrl(appId: number): string {
  return `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`
}
