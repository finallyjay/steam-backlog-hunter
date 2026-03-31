import { NextResponse } from "next/server"
import { getCurrentUser } from "@/app/lib/server-auth"
import { rateLimit } from "@/lib/server/rate-limit"
import { getAchievementsForGame } from "@/lib/server/steam-achievements-sync"
import { getStoredGameForUser } from "@/lib/server/steam-games-sync"

/**
 * POST /api/steam/game/:id/sync
 *
 * Forces a refresh of achievement data for a single game from the Steam API.
 * Updates the local database with the latest achievement progress.
 *
 * @param id - Steam application ID (number, required)
 * @returns {{ achievements: SteamAchievementView[], gameName: string }} Updated achievement data
 * @throws 400 - Valid App ID required
 * @throws 401 - Unauthorized
 * @throws 404 - Game not found
 * @throws 429 - Too many requests
 * @throws 502 - Failed to fetch achievements from Steam
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const appId = Number(id)
  if (!id || !Number.isFinite(appId) || appId <= 0) {
    return NextResponse.json({ error: "Valid App ID required" }, { status: 400 })
  }

  const { success } = rateLimit(`game-sync:${user.steamId}`, 10, 60_000)
  if (!success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const game = await getStoredGameForUser(user.steamId, appId)
  if (!game) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 })
  }

  const result = await getAchievementsForGame(user.steamId, appId, { forceRefresh: true })

  if (!result) {
    return NextResponse.json({ error: "Failed to fetch achievements from Steam" }, { status: 502 })
  }

  return NextResponse.json({
    achievements: result.achievements,
    gameName: result.gameName,
  })
}
