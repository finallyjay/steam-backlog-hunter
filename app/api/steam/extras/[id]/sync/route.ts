import { NextResponse } from "next/server"
import { getCurrentUser } from "@/app/lib/server-auth"
import { rateLimit } from "@/lib/server/rate-limit"
import { getExtraAchievementsList, getStoredExtraGame, syncExtraGameAchievements } from "@/lib/server/extra-games"
import { logger } from "@/lib/server/logger"

/**
 * POST /api/steam/extras/:id/sync
 *
 * Forces a refresh of a single extra's achievement data from the Steam API
 * (same calls as the library counterpart: GetPlayerAchievements, with the
 * schema as fallback for apps Steam does not report as owned). Returns the
 * refreshed detail in the same shape as GET /api/steam/extras/:id.
 *
 * @param id - Steam application ID (number, required)
 * @ratelimit 10 requests per minute per user
 * @returns {{ game: ExtraGame, achievements: SteamAchievementView[] }}
 * @throws 400 - Valid App ID required
 * @throws 401 - Unauthorized
 * @throws 404 - Extra game not found
 * @throws 429 - Too many requests
 * @throws 502 - Steam did not answer
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

  const { success } = rateLimit(`extra-sync:${user.steamId}`, 10, 60_000)
  if (!success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  if (!getStoredExtraGame(user.steamId, appId)) {
    return NextResponse.json({ error: "Extra game not found" }, { status: 404 })
  }

  try {
    await syncExtraGameAchievements(user.steamId, appId)
  } catch (error) {
    logger.error({ err: error, endpoint: "steam/extras/[id]/sync", appId }, "Extra game sync error")
    return NextResponse.json({ error: "Failed to refresh achievements from Steam" }, { status: 502 })
  }

  const game = getStoredExtraGame(user.steamId, appId)
  const achievements = await getExtraAchievementsList(user.steamId, appId)
  return NextResponse.json({ game, achievements: achievements ?? [] })
}
