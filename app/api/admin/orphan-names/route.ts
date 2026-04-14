import { NextResponse } from "next/server"

import { requireAdmin } from "@/app/lib/require-admin"
import { listOrphanNames } from "@/lib/server/orphan-names"
import { logger } from "@/lib/server/logger"

/**
 * GET /api/admin/orphan-names
 *
 * Lists every appid referenced by at least one user's library or extras
 * that has a NULL/empty `games.name`. Admin-only.
 */
export async function GET() {
  try {
    const admin = await requireAdmin()
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    return NextResponse.json({ orphans: listOrphanNames() })
  } catch (error) {
    logger.error({ err: error }, "List orphan names error")
    return NextResponse.json({ error: "Failed to list orphan names" }, { status: 500 })
  }
}
