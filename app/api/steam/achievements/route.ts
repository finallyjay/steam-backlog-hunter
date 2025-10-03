import { type NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/app/lib/server-auth"
import { getPlayerAchievements, getGameSchema } from "@/lib/steam-api"

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const appId = searchParams.get("appId")

    if (!appId) {
      return NextResponse.json({ error: "App ID required" }, { status: 400 })
    }

    const achievements = await getPlayerAchievements(user.steamId, Number(appId))

    if (!achievements) {
      return NextResponse.json({ error: "Failed to fetch achievements" }, { status: 404 })
    }

    const schema = await getGameSchema(Number(appId))

    // Merge achievement data with schema for descriptions and icons
    const enrichedAchievements = achievements.achievements.map((achievement) => {
      const schemaAchievement = schema?.availableGameStats?.achievements?.find(
        (a: any) => a.name === achievement.apiname,
      )

      return {
        ...achievement,
        displayName: schemaAchievement?.displayName || achievement.name || achievement.apiname,
        description: schemaAchievement?.description || achievement.description || "",
        icon: schemaAchievement?.icon || "",
        icongray: schemaAchievement?.icongray || "",
      }
    })

    return NextResponse.json({
      ...achievements,
      achievements: enrichedAchievements,
    })
  } catch (error) {
    console.error("Steam achievements API error:", error)
    return NextResponse.json({ error: "Failed to fetch achievements" }, { status: 500 })
  }
}
