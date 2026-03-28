import { getSqliteDatabase } from "@/lib/server/sqlite"
import { NextResponse } from "next/server"

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
