import { type NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/app/lib/server-auth"
import { getOwnedGames, getRecentlyPlayedGames } from "@/lib/steam-api"

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const type = searchParams.get("type") || "recent"

    let games
    if (type === "all") {
      games = await getOwnedGames(user.steamId)
    } else {
      games = await getRecentlyPlayedGames(user.steamId)
    }

    return NextResponse.json({ games })
  } catch (error) {
    console.error("Steam games API error:", error)
    return NextResponse.json({ error: "Failed to fetch games" }, { status: 500 })
  }
}
