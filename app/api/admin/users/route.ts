import { NextResponse } from "next/server"
import { requireAdmin } from "@/app/lib/require-admin"
import { getSqliteDatabase } from "@/lib/server/sqlite"
import { logger } from "@/lib/server/logger"

/** GET /api/admin/users - List allowed users */
export async function GET() {
  try {
    const admin = await requireAdmin()
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const db = getSqliteDatabase()
    const users = db.prepare("SELECT steam_id, added_by, added_at FROM allowed_users ORDER BY added_at DESC").all()
    return NextResponse.json({ users })
  } catch (error) {
    logger.error({ err: error }, "List users error")
    return NextResponse.json({ error: "Failed to list users" }, { status: 500 })
  }
}

/** POST /api/admin/users - Add allowed user */
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

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const { steamId } = body as { steamId?: string }
    if (!steamId || !/^\d{17}$/.test(steamId)) {
      return NextResponse.json({ error: "Valid Steam ID required (17 digits)" }, { status: 400 })
    }

    const db = getSqliteDatabase()
    db.prepare("INSERT OR IGNORE INTO allowed_users (steam_id, added_by, added_at) VALUES (?, ?, ?)").run(
      steamId,
      admin.steamId,
      new Date().toISOString(),
    )
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error({ err: error }, "Add user error")
    return NextResponse.json({ error: "Failed to add user" }, { status: 500 })
  }
}

/** DELETE /api/admin/users - Remove allowed user */
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

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const { steamId } = body as { steamId?: string }
    if (!steamId || !/^\d{17}$/.test(steamId)) {
      return NextResponse.json({ error: "Valid Steam ID required (17 digits)" }, { status: 400 })
    }

    if (steamId === admin.steamId) {
      return NextResponse.json({ error: "Cannot remove yourself" }, { status: 400 })
    }

    const db = getSqliteDatabase()
    db.prepare("DELETE FROM allowed_users WHERE steam_id = ?").run(steamId)
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error({ err: error }, "Remove user error")
    return NextResponse.json({ error: "Failed to remove user" }, { status: 500 })
  }
}
