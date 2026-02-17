import type { SteamUser } from "@/lib/auth"
import type { SteamAchievementsResponse, SteamGamesResponse, SteamStatsResponse } from "@/lib/types/steam"

export type AuthMeResponse = {
  user: SteamUser | null
}

export type SteamStatsApiResponse = SteamStatsResponse | { error: string }

export type SteamGamesApiResponse = SteamGamesResponse | { error: string }

export type SteamAchievementsApiResponse = SteamAchievementsResponse | { error: string }
