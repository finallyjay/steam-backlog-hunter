import { NextResponse } from "next/server"
import { getCurrentUser } from "@/app/lib/server-auth"
import { getOwnedGames } from "@/lib/steam-api"

export async function GET(
  request: Request,
  { params }: { params: { appId: string } }
) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const appId = params.appId
  if (!appId) {
    return NextResponse.json({ error: "App ID required" }, { status: 400 })
  }

  // Find the game in the user's owned games list
  const games = await getOwnedGames(user.steamId)
  const game = games.find((g) => g.appid.toString() === appId)

  if (!game) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 })
  }

  return NextResponse.json({ game })
}