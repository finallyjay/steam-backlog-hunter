import { NextResponse } from "next/server"

import { getCurrentUser } from "@/app/lib/server-auth"
import { rateLimit } from "@/lib/server/rate-limit"
import { reseedTrackedGamesServer } from "@/lib/server/tracked-games"
import { getUserSyncStatus, synchronizeUserData } from "@/lib/server/steam-store"
import { logger } from "@/lib/server/logger"

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    return NextResponse.json(getUserSyncStatus(user.steamId))
  } catch (error) {
    logger.error({ err: error, endpoint: "steam/sync" }, "Steam sync status API error")
    return NextResponse.json({ error: "Failed to load Steam sync status" }, { status: 500 })
  }
}

export async function POST() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { success } = rateLimit(`sync:${user.steamId}`, 5, 60_000)
    if (!success) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    await reseedTrackedGamesServer(user.steamId)
    const result = await synchronizeUserData(user.steamId)
    return NextResponse.json(result)
  } catch (error) {
    logger.error({ err: error, endpoint: "steam/sync" }, "Steam sync API error")
    return NextResponse.json({ error: "Failed to synchronize Steam data" }, { status: 500 })
  }
}
