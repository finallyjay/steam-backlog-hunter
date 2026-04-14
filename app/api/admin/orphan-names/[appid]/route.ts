import { NextResponse } from "next/server"

import { requireAdmin } from "@/app/lib/require-admin"
import { clearManualName, setManualName } from "@/lib/server/orphan-names"
import { logger } from "@/lib/server/logger"

async function parseAppId(params: Promise<{ appid: string }>) {
  const { appid } = await params
  const n = Number(appid)
  if (!Number.isInteger(n) || n <= 0) return null
  return n
}

/**
 * PUT /api/admin/orphan-names/:appid
 *
 * Body: `{ name: string }` — must be 1..200 chars after trimming.
 * Upserts the name into `games` with `name_source = 'manual'`, freezing
 * it against every auto-sync path.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ appid: string }> }) {
  try {
    const admin = await requireAdmin()
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const appid = await parseAppId(params)
    if (appid === null) return NextResponse.json({ error: "Valid appid required" }, { status: 400 })

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const { name } = (body ?? {}) as { name?: unknown }
    if (typeof name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 })
    }

    try {
      setManualName(appid, name)
    } catch (error) {
      if (error instanceof RangeError) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      throw error
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error({ err: error }, "Set orphan name error")
    return NextResponse.json({ error: "Failed to set orphan name" }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/orphan-names/:appid
 *
 * Reverts a manual name back to the auto resolution chain by clearing
 * the name and setting `name_source = 'auto'`. The next hydrate pass
 * will try to resolve it again via catalog → store → schema → support
 * → community.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ appid: string }> }) {
  try {
    const admin = await requireAdmin()
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const appid = await parseAppId(params)
    if (appid === null) return NextResponse.json({ error: "Valid appid required" }, { status: 400 })

    clearManualName(appid)
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error({ err: error }, "Clear orphan name error")
    return NextResponse.json({ error: "Failed to clear orphan name" }, { status: 500 })
  }
}
