import type { AllowedSteamGame } from "@/lib/types/steam"

let clientAllowedIdsPromise: Promise<Set<string>> | null = null

/** Extracts a Set of string app IDs from an array of allowed game objects. */
export function parseAllowedGameIds(games: AllowedSteamGame[]): Set<string> {
  return new Set(games.map((game) => String(game.id)))
}

/** Fetches tracked game IDs from the API with request deduplication (client-side). */
export async function getAllowedGameIdsClient(): Promise<Set<string>> {
  if (!clientAllowedIdsPromise) {
    clientAllowedIdsPromise = fetch("/api/steam/tracked-games")
      .then((response) => {
        if (!response.ok) {
          throw new Error("Failed to fetch tracked games")
        }
        return response.json() as Promise<{ appIds?: number[] } | AllowedSteamGame[]>
      })
      .then((data) => {
        if (Array.isArray(data)) {
          return parseAllowedGameIds(data)
        }

        return new Set((data.appIds || []).map((id) => String(id)))
      })
  }

  return clientAllowedIdsPromise
}

/** Resets the cached allowed games promise, forcing a fresh fetch on next access. */
export function __resetAllowedGamesClientCache(): void {
  clientAllowedIdsPromise = null
}
