// Pure Steam CDN URL builders. Kept in their own module (no `server-only`,
// no network access) so client components can import them without pulling
// the server-side Steam API client — and its pino logger — into the browser
// bundle.

/** Builds a Steam community image URL from an app ID and image hash. */
export function getSteamImageUrl(appId: number, imageHash: string): string {
  if (!imageHash) return "/placeholder-icon.svg"

  return `https://media.steampowered.com/steamcommunity/public/images/apps/${appId}/${imageHash}.jpg`
}

/** Builds a Steam store header image URL for a game (landscape 460x215). */
export function getSteamHeaderImageUrl(appId: number): string {
  return `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`
}

/** Builds a Steam library portrait image URL for a game (600x900, 2:3). */
export function getSteamPortraitImageUrl(appId: number): string {
  return `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`
}
