import { NextResponse } from "next/server"

import { getCurrentUser } from "@/app/lib/server-auth"
import { reseedTrackedGamesServer } from "@/lib/server/tracked-games"
import { getUserSyncStatus, synchronizeUserData } from "@/lib/server/steam-store"

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    return NextResponse.json(getUserSyncStatus(user.steamId))
  } catch (error) {
    console.error("Steam sync status API error:", error)
    return NextResponse.json({ error: "Failed to load Steam sync status" }, { status: 500 })
  }
}

export async function POST() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    await reseedTrackedGamesServer(user.steamId)
    const result = await synchronizeUserData(user.steamId)
    return NextResponse.json(result)
  } catch (error) {
    console.error("Steam sync API error:", error)
    return NextResponse.json(
      { error: "Failed to synchronize Steam data" },
      { status: 500 },
    )
  }
}
