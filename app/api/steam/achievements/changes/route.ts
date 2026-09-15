import { type NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/app/lib/server-auth"
import { listAchievementChanges, markAchievementChangesSeen } from "@/lib/server/steam-store"
import { logger } from "@/lib/server/logger"

/**
 * GET /api/steam/achievements/changes
 *
 * Lists detected achievement schema changes (new or retired achievements)
 * for games the authenticated user owns, newest first.
 *
 * @query unseen - "1" to return only changes not yet acknowledged (string, optional)
 * @query limit - Maximum rows to return, 1–500 (integer, optional, default 100; non-integers are ignored)
 * @returns {{ changes: AchievementChangeView[] }} Detected changes
 * @throws 401 - Unauthorized
 * @throws 500 - Server error
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const unseenOnly = searchParams.get("unseen") === "1"
    const rawLimit = Number(searchParams.get("limit"))
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : undefined

    const changes = listAchievementChanges(user.steamId, { unseenOnly, limit })
    return NextResponse.json({ changes })
  } catch (error) {
    logger.error({ err: error, endpoint: "steam/achievements/changes" }, "Achievement changes API error")
    return NextResponse.json({ error: "Failed to load achievement changes" }, { status: 500 })
  }
}

/**
 * PATCH /api/steam/achievements/changes
 *
 * Marks achievement changes as seen for the authenticated user. Only rows
 * belonging to the user are affected.
 *
 * @body ids - Change ids to acknowledge (number[], optional). Omit, or send an
 *             empty body, to acknowledge every unseen change.
 * @returns {{ updated: number }} Number of rows marked as seen
 * @throws 400 - Invalid body
 * @throws 401 - Unauthorized
 * @throws 500 - Server error
 */
export async function PATCH(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    let ids: number[] | undefined
    const rawBody = await request.text()
    if (rawBody.trim().length > 0) {
      let parsed: unknown
      try {
        parsed = JSON.parse(rawBody)
      } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
      }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 })
      }
      const candidate = (parsed as { ids?: unknown }).ids
      if (candidate !== undefined) {
        if (!Array.isArray(candidate) || !candidate.every((id) => Number.isInteger(id) && id > 0)) {
          return NextResponse.json({ error: "ids must be an array of positive integers" }, { status: 400 })
        }
        ids = candidate as number[]
      }
    }

    const updated = markAchievementChangesSeen(user.steamId, ids)
    return NextResponse.json({ updated })
  } catch (error) {
    logger.error({ err: error, endpoint: "steam/achievements/changes" }, "Achievement changes API error")
    return NextResponse.json({ error: "Failed to update achievement changes" }, { status: 500 })
  }
}
