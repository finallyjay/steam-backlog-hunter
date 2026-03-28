import { NextResponse } from "next/server"

import { getCurrentUser } from "@/app/lib/server-auth"
import { getTrackedGameIdsServer, reseedTrackedGamesServer } from "@/lib/server/tracked-games"

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const appIds = Array.from(await getTrackedGameIdsServer(user.steamId)).map((id) => Number(id)).sort((a, b) => a - b)
    return NextResponse.json({ appIds })
  } catch (error) {
    console.error("Tracked games API error:", error)
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
    console.error("Tracked games reseed API error:", error)
    return NextResponse.json({ error: "Failed to reseed tracked games" }, { status: 500 })
  }
}
