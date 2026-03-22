import type { AllowedSteamGame } from "@/lib/types/steam"

let clientAllowedIdsPromise: Promise<Set<string>> | null = null

export function parseAllowedGameIds(games: AllowedSteamGame[]): Set<string> {
  return new Set(games.map((game) => String(game.id)))
}

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

export function __resetAllowedGamesClientCache(): void {
  clientAllowedIdsPromise = null
}
