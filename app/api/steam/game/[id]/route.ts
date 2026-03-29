import { NextResponse } from "next/server"
import { getCurrentUser } from "@/app/lib/server-auth"
import { getStoredGameForUser } from "@/lib/server/steam-store"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const appId = Number(id)
  if (!id || !Number.isFinite(appId) || appId <= 0) {
    return NextResponse.json({ error: "Valid App ID required" }, { status: 400 })
  }

  const game = await getStoredGameForUser(user.steamId, appId)

  if (!game) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 })
  }

  return NextResponse.json({ game })
}
