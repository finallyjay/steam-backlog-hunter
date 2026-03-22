export interface SteamGame {
  appid: number
  name: string
  playtime_forever: number
  playtime_2weeks?: number
  img_icon_url: string
  img_logo_url: string
  header_image_url?: string
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
      cache: 'no-store',
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
    const data = await steamAPIRequest("/IPlayerService/GetOwnedGames/v1/", {
      steamid: steamId,
      include_appinfo: "1",
      include_played_free_games: "1",
      l: "es"
    })

    return data.response?.games || []
  } catch (error) {
    console.error("Error fetching owned games:", error)
    return []
  }
}

export async function getRecentlyPlayedGames(steamId: string): Promise<SteamGame[]> {
  try {
    const data = await steamAPIRequest("/IPlayerService/GetRecentlyPlayedGames/v1/", {
      steamid: steamId,
      count: "10",
      l: "es"
    })

    return data.response?.games || []
  } catch (error) {
    console.error("Error fetching recently played games:", error)
    return []
  }
}

export async function getPlayerAchievements(steamId: string, appId: number): Promise<GameAchievements | null> {
  try {
    const data = await steamAPIRequest("/ISteamUserStats/GetPlayerAchievements/v1/", {
      steamid: steamId,
      appid: appId.toString(),
      l: "es"
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

export async function getGameSchema(appId: number): Promise<unknown> {
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

type StoreAppDetailsResponse = Record<string, {
  success?: boolean
  data?: {
    header_image?: string
  }
}>

export async function getStoreHeaderImages(appIds: number[]) {
  if (appIds.length === 0) {
    return {}
  }

  const url = new URL("https://store.steampowered.com/api/appdetails")
  url.searchParams.set("appids", appIds.join(","))
  url.searchParams.set("l", "es")

  try {
    const response = await fetch(url.toString(), {
      cache: "no-store",
    })

    if (!response.ok) {
      throw new SteamAPIError(`Steam Store request failed: ${response.status}`, response.status)
    }

    const data = await response.json() as StoreAppDetailsResponse
    return Object.fromEntries(
      Object.entries(data).flatMap(([appId, payload]) => {
        const headerImage = payload?.success ? payload.data?.header_image : undefined
        return headerImage ? [[Number(appId), headerImage]] : []
      }),
    ) as Record<number, string>
  } catch (error) {
    console.error("Error fetching store header images:", error)
    return {}
  }
}

export function getSteamImageUrl(appId: number, imageHash: string): string {
  if (!imageHash) return "/placeholder.svg"

  return `https://media.steampowered.com/steamcommunity/public/images/apps/${appId}/${imageHash}.jpg`
}

export function getSteamHeaderImageUrl(appId: number): string {
  return `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`
}
