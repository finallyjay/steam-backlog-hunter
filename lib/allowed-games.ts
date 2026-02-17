import type { AllowedSteamGame } from "@/lib/types/steam"

let clientAllowedIdsPromise: Promise<Set<string>> | null = null

export function parseAllowedGameIds(games: AllowedSteamGame[]): Set<string> {
  return new Set(games.map((game) => String(game.id)))
}

export async function getAllowedGameIdsClient(): Promise<Set<string>> {
  if (!clientAllowedIdsPromise) {
    clientAllowedIdsPromise = fetch("/steam_games_with_achievements.json")
      .then((response) => {
        if (!response.ok) {
          throw new Error("Failed to fetch allowed games")
        }
        return response.json() as Promise<AllowedSteamGame[]>
      })
      .then(parseAllowedGameIds)
  }

  return clientAllowedIdsPromise
}

export async function getAllowedGameIdsServer(): Promise<Set<string>> {
  const { readFile } = await import("node:fs/promises")
  const { join } = await import("node:path")
  const jsonPath = join(process.cwd(), "public", "steam_games_with_achievements.json")
  const rawJson = await readFile(jsonPath, "utf-8")
  const games = JSON.parse(rawJson) as AllowedSteamGame[]
  return parseAllowedGameIds(games)
}

export function __resetAllowedGamesClientCache(): void {
  clientAllowedIdsPromise = null
}
