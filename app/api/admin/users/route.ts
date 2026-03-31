import { NextResponse } from "next/server"
import { requireAdmin } from "@/app/lib/require-admin"
import { getSqliteDatabase } from "@/lib/server/sqlite"
import { upsertProfile } from "@/lib/server/steam-store-utils"
import { logger } from "@/lib/server/logger"

/** GET /api/admin/users - List allowed users with profile info */
export async function GET() {
  try {
    const admin = await requireAdmin()
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const db = getSqliteDatabase()
    const users = db
      .prepare(
        `
      SELECT
        au.steam_id,
        au.added_by,
        au.added_at,
        sp.persona_name,
        sp.avatar_url,
        sp.profile_url,
        sp.last_login_at
      FROM allowed_users au
      LEFT JOIN steam_profile sp ON sp.steam_id = au.steam_id
      ORDER BY au.added_at DESC
    `,
      )
      .all()
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

    // Try to fetch profile info from Steam
    await refreshSteamProfile(steamId)

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

/** PATCH /api/admin/users - Refresh a user's Steam profile data */
export async function PATCH(request: Request) {
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
    const exists = db.prepare("SELECT 1 FROM allowed_users WHERE steam_id = ?").get(steamId)
    if (!exists) {
      return NextResponse.json({ error: "User not found in allowed list" }, { status: 404 })
    }

    const profile = await refreshSteamProfile(steamId)
    if (!profile) {
      return NextResponse.json({ error: "Could not fetch Steam profile" }, { status: 502 })
    }

    return NextResponse.json({ success: true, profile })
  } catch (error) {
    logger.error({ err: error }, "Refresh user profile error")
    return NextResponse.json({ error: "Failed to refresh profile" }, { status: 500 })
  }
}

/** Fetches a user's Steam profile and updates the local database. */
async function refreshSteamProfile(steamId: string) {
  const apiKey = process.env.STEAM_API_KEY
  if (!apiKey) return null

  try {
    const url = new URL("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/")
    url.searchParams.set("key", apiKey)
    url.searchParams.set("steamids", steamId)

    const res = await fetch(url)
    if (!res.ok) return null

    const data = await res.json()
    const player = data.response?.players?.[0]
    if (!player) return null

    upsertProfile(steamId, {
      personaName: player.personaname,
      avatarUrl: player.avatarfull,
      profileUrl: player.profileurl,
    })

    return {
      persona_name: player.personaname,
      avatar_url: player.avatarfull,
      profile_url: player.profileurl,
    }
  } catch {
    return null
  }
}
