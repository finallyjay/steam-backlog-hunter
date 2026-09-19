import { NextResponse } from "next/server"
import { getCurrentUser } from "@/app/lib/server-auth"
import { rateLimit } from "@/lib/server/rate-limit"
import { promoteExtraToLibrary } from "@/lib/server/manual-ownership"
import { logger } from "@/lib/server/logger"

/**
 * POST /api/steam/extras/:id/promote
 *
 * Adds one of the user's extras to their library as a manually owned game.
 * It counts for stats and the achievement scan from now on and the library
 * sync never unmarks it. Its achievements are synced right away.
 *
 * @param id - Steam application ID (number, required)
 * @ratelimit 20 requests per minute per user
 * @returns {{ game: SteamGame }} The promoted game
 * @throws 400 - Valid App ID required
 * @throws 401 - Unauthorized
 * @throws 404 - Extra game not found
 * @throws 429 - Too many requests
 * @throws 500 - Server error
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    const appId = Number(id)
    if (!id || !Number.isFinite(appId) || appId <= 0) {
      return NextResponse.json({ error: "Valid App ID required" }, { status: 400 })
    }

    const { success } = rateLimit(`extra-promote:${user.steamId}`, 20, 60_000)
    if (!success) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    const game = await promoteExtraToLibrary(user.steamId, appId)
    if (!game) {
      return NextResponse.json({ error: "Extra game not found" }, { status: 404 })
    }
    return NextResponse.json({ game })
  } catch (error) {
    logger.error({ err: error, endpoint: "steam/extras/[id]/promote" }, "Extra promotion error")
    return NextResponse.json({ error: "Failed to add the game to the library" }, { status: 500 })
  }
}
