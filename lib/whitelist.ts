export function getSteamWhitelist(): Set<string> {
  const rawWhitelist = process.env.STEAM_WHITELIST_IDS

  if (!rawWhitelist) {
    return new Set()
  }

  const ids = rawWhitelist
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0)

  return new Set(ids)
}

export function isSteamIdWhitelisted(steamId: string): boolean {
  const whitelist = getSteamWhitelist()
  return whitelist.has(steamId)
}
