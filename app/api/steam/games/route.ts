import { type NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/app/lib/server-auth"
import { getOwnedGamesForUser, getRecentlyPlayedGamesForUser } from "@/lib/server/steam-store"

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const type = searchParams.get("type") || "recent"
    const forceRefresh = searchParams.get("refresh") === "1" || searchParams.get("force") === "1"

    let games
    if (type === "all") {
      games = await getOwnedGamesForUser(user.steamId, { forceRefresh })
    } else {
      games = await getRecentlyPlayedGamesForUser(user.steamId, { forceRefresh })
    }

    return NextResponse.json({ games })
  } catch (error) {
    console.error("Steam games API error:", error)
    return NextResponse.json({ error: "Failed to fetch games" }, { status: 500 })
  }
}
