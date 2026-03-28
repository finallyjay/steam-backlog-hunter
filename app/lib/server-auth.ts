import { cookies } from "next/headers"
import type { SteamUser } from "@/lib/auth"
import { isSteamIdWhitelisted } from "@/lib/whitelist"
import { logger } from "@/lib/server/logger"

export async function getCurrentUser(): Promise<SteamUser | null> {
  try {
    const cookieStore = await cookies()
    const userCookie = cookieStore.get("steam_user")

    if (!userCookie?.value) {
      return null
    }

    const user = JSON.parse(userCookie.value) as SteamUser

    if (!isSteamIdWhitelisted(user.steamId)) {
      cookieStore.delete("steam_user")
      return null
    }

    return user
  } catch (error) {
    logger.error({ err: error }, "Error getting current user")
    return null
  }
}

export async function requireAuth(): Promise<SteamUser> {
  const user = await getCurrentUser()

  if (!user) {
    throw new Error("Authentication required")
  }

  return user
}
