import { NextResponse } from "next/server"
import { getCurrentUser } from "@/app/lib/server-auth"
import { getStoredExtraGame, getExtraAchievementsList } from "@/lib/server/extra-games"
import { logger } from "@/lib/server/logger"

/** GET /api/steam/extras/:id — returns an extra game's detail + enriched achievements. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
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

    const game = getStoredExtraGame(user.steamId, appId)
    if (!game) {
      return NextResponse.json({ error: "Extra game not found" }, { status: 404 })
    }

    const achievements = await getExtraAchievementsList(user.steamId, appId)

    return NextResponse.json({
      game,
      achievements: achievements ?? [],
    })
  } catch (error) {
    logger.error({ err: error, endpoint: "steam/extras/[id]" }, "Extra game detail error")
    return NextResponse.json({ error: "Failed to fetch extra game detail" }, { status: 500 })
  }
}
