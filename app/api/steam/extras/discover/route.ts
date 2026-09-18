import { NextResponse } from "next/server"

import { getCurrentUser } from "@/app/lib/server-auth"
import { discoverExtraGames, getExtrasDiscoveryStatus } from "@/lib/server/extra-games"
import { rateLimit } from "@/lib/server/rate-limit"
import { logger } from "@/lib/server/logger"

/**
 * GET /api/steam/extras/discover
 *
 * Reports whether a manual extras discovery is running for the
 * authenticated user and when the last one completed.
 *
 * @returns {{ running: boolean, lastDiscoveryAt: string | null }}
 * @throws 401 - Unauthorized
 * @throws 500 - Server error
 */
export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    return NextResponse.json(getExtrasDiscoveryStatus(user.steamId))
  } catch (error) {
    logger.error({ err: error, endpoint: "steam/extras/discover" }, "Extras discovery status API error")
    return NextResponse.json({ error: "Failed to load extras discovery status" }, { status: 500 })
  }
}

/**
 * POST /api/steam/extras/discover
 *
 * Runs the full extras discovery for the authenticated user: ingests every
 * game Steam remembers the account played but does not own, syncs their
 * achievements, resolves names and images. Slow on large accounts (hundreds
 * of store lookups on a first run). Concurrent requests for the same user
 * join the in-flight run.
 *
 * @ratelimit 2 requests per 10 minutes per user
 * @returns {{ discoveredAt: string, added: number, updated: number, total: number }}
 * @throws 401 - Unauthorized
 * @throws 429 - Too many requests
 * @throws 500 - Server error
 */
export async function POST() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { success } = rateLimit(`extras-discover:${user.steamId}`, 2, 10 * 60_000)
    if (!success) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    const result = await discoverExtraGames(user.steamId)
    return NextResponse.json(result)
  } catch (error) {
    logger.error({ err: error, endpoint: "steam/extras/discover" }, "Extras discovery API error")
    return NextResponse.json({ error: "Failed to discover extras" }, { status: 500 })
  }
}
