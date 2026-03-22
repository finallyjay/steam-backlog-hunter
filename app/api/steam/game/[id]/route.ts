import { NextResponse } from "next/server"
import { getCurrentUser } from "@/app/lib/server-auth"
import { getStoredGameForUser } from "@/lib/server/steam-store"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: appId } = await params
  if (!appId) {
    return NextResponse.json({ error: "App ID required" }, { status: 400 })
  }

  const game = await getStoredGameForUser(user.steamId, Number(appId))

  if (!game) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 })
  }

  return NextResponse.json({ game })
}
