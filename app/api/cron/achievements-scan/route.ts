import { timingSafeEqual } from "node:crypto"
import { type NextRequest, NextResponse } from "next/server"

import { env } from "@/lib/env"
import {
  getLastAchievementScan,
  isAchievementScanRunning,
  MAX_GAMES_PER_USER_CAP,
  runAchievementScan,
} from "@/lib/server/achievement-scan"
import { rateLimit } from "@/lib/server/rate-limit"
import { logger } from "@/lib/server/logger"

type AuthResult = { ok: true } | { ok: false; response: NextResponse }

/**
 * Shared-secret auth for the scheduler. No session cookie is involved: the
 * caller is a cron job, not a browser. Constant-time comparison so the token
 * can't be guessed byte by byte from response timing.
 */
function authorize(request: NextRequest): AuthResult {
  const secret = env.CRON_SECRET
  if (!secret) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Achievement scan is not configured (CRON_SECRET unset)" }, { status: 503 }),
    }
  }

  const header = request.headers.get("authorization") ?? ""
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : ""
  const expected = Buffer.from(secret)
  const provided = Buffer.from(token)
  if (!token || provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }
  return { ok: true }
}

/**
 * GET /api/cron/achievements-scan
 *
 * Reports whether a scan is currently running in this process and the last
 * recorded run (from `achievement_scan_meta`).
 *
 * @header Authorization - `Bearer <CRON_SECRET>` (required)
 * @returns {{ running: boolean, lastRun: AchievementScanMeta | null }}
 * @throws 401 - Missing or wrong secret
 * @throws 503 - CRON_SECRET not configured
 */
export async function GET(request: NextRequest) {
  const auth = authorize(request)
  if (!auth.ok) return auth.response

  try {
    return NextResponse.json({ running: isAchievementScanRunning(), lastRun: getLastAchievementScan() })
  } catch (error) {
    logger.error({ err: error, endpoint: "cron/achievements-scan" }, "Achievement scan status error")
    return NextResponse.json({ error: "Failed to read scan status" }, { status: 500 })
  }
}

/**
 * POST /api/cron/achievements-scan
 *
 * Runs a library-wide achievement re-sync for every whitelisted user with a
 * completed owned-games sync, so new or retired achievements are detected
 * and recorded without anyone opening the app. Intended for a daily
 * scheduler (GitHub Actions workflow, system cron, hosting scheduler).
 *
 * @header Authorization - `Bearer <CRON_SECRET>` (required)
 * @body maxGamesPerUser - Optional cap on games visited per user, 1–5000; highest-priority games first
 * @ratelimit 6 requests per hour (the job is meant to run once a day; the headroom is for retries)
 * @returns {AchievementScanResult} Per-user and total counts for the run
 * @throws 400 - Invalid body
 * @throws 401 - Missing or wrong secret
 * @throws 409 - A scan is already running
 * @throws 429 - Too many requests
 * @throws 503 - CRON_SECRET not configured
 */
export async function POST(request: NextRequest) {
  const auth = authorize(request)
  if (!auth.ok) return auth.response

  const { success } = rateLimit("cron:achievements-scan", 6, 60 * 60_000)
  if (!success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  let maxGamesPerUser: number | undefined
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
    const candidate = (parsed as { maxGamesPerUser?: unknown }).maxGamesPerUser
    if (candidate !== undefined) {
      if (!Number.isInteger(candidate) || (candidate as number) < 1 || (candidate as number) > MAX_GAMES_PER_USER_CAP) {
        return NextResponse.json(
          { error: `maxGamesPerUser must be an integer between 1 and ${MAX_GAMES_PER_USER_CAP}` },
          { status: 400 },
        )
      }
      maxGamesPerUser = candidate as number
    }
  }

  if (isAchievementScanRunning()) {
    return NextResponse.json({ error: "A scan is already running" }, { status: 409 })
  }

  try {
    const result = await runAchievementScan({ maxGamesPerUser })
    return NextResponse.json(result)
  } catch (error) {
    logger.error({ err: error, endpoint: "cron/achievements-scan" }, "Achievement scan failed")
    return NextResponse.json({ error: "Achievement scan failed" }, { status: 500 })
  }
}
