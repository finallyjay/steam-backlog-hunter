import { NextResponse } from "next/server"

import { getCurrentUser } from "@/app/lib/server-auth"
import { getTrackedGameIdsServer, reseedTrackedGamesServer } from "@/lib/server/tracked-games"
import { logger } from "@/lib/server/logger"

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const appIds = Array.from(await getTrackedGameIdsServer(user.steamId))
      .map((id) => Number(id))
      .sort((a, b) => a - b)
    return NextResponse.json({ appIds })
  } catch (error) {
    logger.error({ err: error, endpoint: "steam/tracked-games" }, "Tracked games API error")
    return NextResponse.json({ error: "Failed to fetch tracked games" }, { status: 500 })
  }
}

export async function POST() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const result = await reseedTrackedGamesServer(user.steamId)
    return NextResponse.json(result)
  } catch (error) {
    logger.error({ err: error, endpoint: "steam/tracked-games" }, "Tracked games reseed API error")
    return NextResponse.json({ error: "Failed to reseed tracked games" }, { status: 500 })
  }
}
