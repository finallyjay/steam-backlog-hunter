import { env } from "@/lib/env"

const STEAM_ID_REGEX = /^\d{17}$/

/** Parses STEAM_WHITELIST_IDS into a Set of valid Steam64 IDs. */
export function getSteamWhitelist(): Set<string> {
  const rawWhitelist = env.STEAM_WHITELIST_IDS

  if (!rawWhitelist) {
    return new Set()
  }

  const ids = rawWhitelist
    .split(",")
    .map((id) => id.trim())
    .filter((id) => STEAM_ID_REGEX.test(id))

  return new Set(ids)
}

/** Checks whether a Steam64 ID is in the configured whitelist. */
export function isSteamIdWhitelisted(steamId: string): boolean {
  const whitelist = getSteamWhitelist()
  return whitelist.has(steamId)
}
