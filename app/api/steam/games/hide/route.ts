import { NextResponse } from "next/server"
import { getCurrentUser } from "@/app/lib/server-auth"
import { getSqliteDatabase } from "@/lib/server/sqlite"
import { logger } from "@/lib/server/logger"

/** POST /api/steam/games/hide - Hide a game */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { appId } = await request.json()
    if (!appId || !Number.isFinite(Number(appId))) {
      return NextResponse.json({ error: "Valid appId required" }, { status: 400 })
    }

    const db = getSqliteDatabase()
    db.prepare("INSERT OR IGNORE INTO hidden_games (steam_id, appid, hidden_at) VALUES (?, ?, ?)").run(
      user.steamId,
      Number(appId),
      new Date().toISOString(),
    )
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error({ err: error }, "Hide game error")
    return NextResponse.json({ error: "Failed to hide game" }, { status: 500 })
  }
}

/** DELETE /api/steam/games/hide - Unhide a game */
export async function DELETE(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { appId } = await request.json()
    if (!appId || !Number.isFinite(Number(appId))) {
      return NextResponse.json({ error: "Valid appId required" }, { status: 400 })
    }

    const db = getSqliteDatabase()
    db.prepare("DELETE FROM hidden_games WHERE steam_id = ? AND appid = ?").run(user.steamId, Number(appId))
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error({ err: error }, "Unhide game error")
    return NextResponse.json({ error: "Failed to unhide game" }, { status: 500 })
  }
}
