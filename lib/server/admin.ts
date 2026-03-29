import "server-only"

import { env } from "@/lib/env"

/** Checks if the given Steam ID is the admin. */
export function isAdmin(steamId: string): boolean {
  return Boolean(env.ADMIN_STEAM_ID && env.ADMIN_STEAM_ID === steamId)
}
