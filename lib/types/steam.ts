import type { SteamAchievement, SteamGame } from "@/lib/steam-api"

export interface AllowedSteamGame {
  id: number
  name: string
}

export interface SteamAchievementView extends SteamAchievement {
  displayName: string
  description: string
  icon: string
  icongray: string
}

export interface SteamStatsResponse {
  totalGames: number
  totalAchievements: number
  totalPlaytime: number
  perfectGames: number
}

export interface SteamGameCardModel {
  id: number
  name: string
  image: string
  playtime: number
  achievements: SteamAchievementView[]
  percent: number
  completed: boolean
  totalAchievements: number
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
