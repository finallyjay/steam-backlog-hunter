import { NextResponse } from "next/server"
import { getCurrentUser } from "@/app/lib/server-auth"
import { getStoredExtraGame, getExtraAchievementsList, setExtraKind } from "@/lib/server/extra-games"
import { isAppKind } from "@/lib/server/app-kind"
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

/**
 * PATCH /api/steam/extras/:id
 *
 * Overrides the kind of one of the user's extras (demo, tool, beta, …)
 * when the automatic classification got it wrong. Send `{ kind: null }`
 * to clear the override and fall back to the automatic classification.
 *
 * @body kind - One of the AppKind values, or null to clear (required)
 * @returns {{ game: ExtraGame }} The refreshed extra
 * @throws 400 - Valid App ID required / invalid body
 * @throws 401 - Unauthorized
 * @throws 404 - Extra game not found
 * @throws 500 - Server error
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

    let parsed: unknown
    try {
      parsed = await request.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed) || !("kind" in parsed)) {
      return NextResponse.json({ error: "Body must be a JSON object with a kind" }, { status: 400 })
    }
    const kind = (parsed as { kind: unknown }).kind
    if (kind !== null && !isAppKind(kind)) {
      return NextResponse.json({ error: "kind must be a known app kind or null" }, { status: 400 })
    }

    const game = setExtraKind(user.steamId, appId, kind)
    if (!game) {
      return NextResponse.json({ error: "Extra game not found" }, { status: 404 })
    }
    return NextResponse.json({ game })
  } catch (error) {
    logger.error({ err: error, endpoint: "steam/extras/[id]" }, "Extra game kind update error")
    return NextResponse.json({ error: "Failed to update extra game" }, { status: 500 })
  }
}
