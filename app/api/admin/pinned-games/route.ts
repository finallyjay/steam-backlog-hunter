import { NextResponse } from "next/server"
import { requireAdmin } from "@/app/lib/require-admin"
import { addPinnedGame, listPinnedGames, removePinnedGame } from "@/lib/server/pinned-games"
import { logger } from "@/lib/server/logger"

/** GET /api/admin/pinned-games — list globally pinned appids. */
export async function GET() {
  try {
    const admin = await requireAdmin()
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    return NextResponse.json({ pinned: listPinnedGames() })
  } catch (error) {
    logger.error({ err: error }, "List pinned games error")
    return NextResponse.json({ error: "Failed to list pinned games" }, { status: 500 })
  }
}

/** POST /api/admin/pinned-games — add an appid to the global pinned list. */
export async function POST(request: Request) {
  try {
    const admin = await requireAdmin()
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const { appid, reason } = (body ?? {}) as { appid?: unknown; reason?: unknown }
    const appidNum = Number(appid)
    if (!Number.isInteger(appidNum) || appidNum <= 0) {
      return NextResponse.json({ error: "Valid appid required" }, { status: 400 })
    }

    addPinnedGame(appidNum, typeof reason === "string" ? reason : null)
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error({ err: error }, "Add pinned game error")
    return NextResponse.json({ error: "Failed to add pinned game" }, { status: 500 })
  }
}

/** DELETE /api/admin/pinned-games — remove an appid from the global pinned list. */
export async function DELETE(request: Request) {
  try {
    const admin = await requireAdmin()
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const { appid } = (body ?? {}) as { appid?: unknown }
    const appidNum = Number(appid)
    if (!Number.isInteger(appidNum) || appidNum <= 0) {
      return NextResponse.json({ error: "Valid appid required" }, { status: 400 })
    }

    removePinnedGame(appidNum)
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error({ err: error }, "Remove pinned game error")
    return NextResponse.json({ error: "Failed to remove pinned game" }, { status: 500 })
  }
}
