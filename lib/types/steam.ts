import type { SteamAchievement, SteamGame } from "@/lib/steam-api"

export interface SteamAchievementView extends SteamAchievement {
  displayName: string
  description: string
  icon: string
  icongray: string
  /** 1 when the game dev marked this achievement as hidden in the schema. */
  hidden: number
  /** % of Steam players who have unlocked this achievement, or null if unknown. */
  globalPercent: number | null
}

export interface SteamStatsResponse {
  totalGames: number
  gamesWithAchievements: number
  totalAchievements: number
  pendingAchievements: number
  startedGames: number
  averageCompletion: number
  totalPlaytime: number
  perfectGames: number
}

export interface SteamGameCardModel {
  id: number
  name: string
  image: string
  imagePortrait?: string | null
  playtime: number
  achievements: SteamAchievementView[]
  percent: number
  completed: boolean
  totalAchievements: number
  unlockedAchievements: number
  platforms?: { windows: boolean; mac: boolean; linux: boolean } | null
  releaseYear?: number | null
}

export type SteamGamesResponse = {
  games: SteamGame[]
}

export type SteamAchievementsResponse = {
  steamID: string
  gameName: string
  achievements: SteamAchievementView[]
  success: boolean
}
