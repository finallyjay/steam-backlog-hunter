import { cookies } from "next/headers"
import type { SteamUser } from "@/lib/auth"
import { isSteamIdWhitelisted } from "@/lib/whitelist"
import { isAdmin } from "@/lib/server/admin"
import { logger } from "@/lib/server/logger"

/**
 * Reads the authenticated user from the steam_user cookie, validating
 * against the whitelist. The returned object is decorated with an
 * `isAdmin` flag derived fresh from env.ADMIN_STEAM_ID on every call —
 * never persisted to the cookie — so toggling the env var takes effect
 * on the user's next request without forcing a logout.
 */
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

    return { ...user, isAdmin: isAdmin(user.steamId) }
  } catch (error) {
    // Next.js throws a DYNAMIC_SERVER_USAGE error when cookies() is
    // invoked during a static-prerender probe. It's not an error — it's
    // the framework's signal that the route is dynamic. Re-throw so
    // Next can catch it, but don't pollute the logs with a bogus
    // "Error getting current user" entry.
    if (error && typeof error === "object" && "digest" in error && String(error.digest).startsWith("DYNAMIC_")) {
      throw error
    }
    logger.error({ err: error }, "Error getting current user")
    return null
  }
}

/** Returns the authenticated user or throws if not logged in. */
export async function requireAuth(): Promise<SteamUser> {
  const user = await getCurrentUser()

  if (!user) {
    throw new Error("Authentication required")
  }

  return user
}
