import { NextResponse } from "next/server"
import { getCurrentUser } from "@/app/lib/server-auth"
import { rateLimit } from "@/lib/server/rate-limit"
import { demoteManualGame } from "@/lib/server/manual-ownership"
import { logger } from "@/lib/server/logger"

/**
 * POST /api/steam/game/:id/demote
 *
 * Returns a manually owned game to extras. Only games the user promoted
 * (owned_source = manual) can be demoted; games Steam reports as owned
 * are left alone.
 *
 * @param id - Steam application ID (number, required)
 * @ratelimit 20 requests per minute per user
 * @returns {{ success: true }}
 * @throws 400 - Valid App ID required
 * @throws 401 - Unauthorized
 * @throws 404 - Not a manually owned game of this user
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

    const { success } = rateLimit(`game-demote:${user.steamId}`, 20, 60_000)
    if (!success) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    if (!demoteManualGame(user.steamId, appId)) {
      return NextResponse.json({ error: "Not a manually owned game" }, { status: 404 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error({ err: error, endpoint: "steam/game/[id]/demote" }, "Game demotion error")
    return NextResponse.json({ error: "Failed to return the game to extras" }, { status: 500 })
  }
}
