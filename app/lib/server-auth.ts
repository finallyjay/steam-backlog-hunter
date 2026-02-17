import { cookies } from "next/headers"
import type { SteamUser } from "@/lib/auth"
import { isSteamIdWhitelisted } from "@/lib/whitelist"

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
    console.error("Error getting current user:", error)
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
