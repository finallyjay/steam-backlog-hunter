import { cookies } from "next/headers"

export interface SteamUser {
  steamId: string
  displayName: string
  avatar: string
  profileUrl: string
}

export async function getCurrentUser(): Promise<SteamUser | null> {
  try {
    const cookieStore = cookies()
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
