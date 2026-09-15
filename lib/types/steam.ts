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

/**
 * One detected achievement schema change for a game the user owns.
 * Produced when Steam's achievement set for the game differs from what
 * was stored (post-launch additions or retired achievements).
 */
export interface AchievementChangeView {
  id: number
  appId: number
  gameName: string
  /** apinames present in Steam's schema but not in our stored copy. */
  added: string[]
  /** apinames we had stored that Steam no longer returns. */
  removed: string[]
  totalBefore: number | null
  totalAfter: number
  /** true when the game was 100% completed before the change. */
  wasPerfect: boolean
  detectedAt: string
  seenAt: string | null
}

export type AchievementChangesResponse = {
  changes: AchievementChangeView[]
}
