import { cookies } from "next/headers"
import type { SteamUser } from "@/lib/auth"

export async function getCurrentUser(): Promise<SteamUser | null> {
  try {
    const cookieStore = await cookies()
    const userCookie = cookieStore.get("steam_user")

    if (!userCookie?.value) {
      return null
    }

    return JSON.parse(userCookie.value) as SteamUser
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
