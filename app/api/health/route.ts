import { getSqliteDatabase } from "@/lib/server/sqlite"
import { NextResponse } from "next/server"

/**
 * GET /api/health
 *
 * Infrastructure health check endpoint. Tests SQLite database connectivity
 * by executing a simple query. No authentication required.
 *
 * @returns {{ status: "ok", timestamp: string }} Health status and current timestamp
 * @throws 503 - Service unavailable if SQLite connection fails
 */
export async function GET() {
  try {
    const db = getSqliteDatabase()
    db.prepare("SELECT 1").get()
    return NextResponse.json({ status: "ok", timestamp: new Date().toISOString() }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ status: "error", message }, { status: 503 })
  }
}
