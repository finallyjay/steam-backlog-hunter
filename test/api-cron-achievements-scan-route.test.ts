// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/env", () => ({
  env: new Proxy(
    {},
    {
      get(_target, prop) {
        return process.env[prop as string]
      },
    },
  ),
}))

vi.mock("@/lib/server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock("@/lib/server/achievement-scan", () => ({
  runAchievementScan: vi.fn(),
  getLastAchievementScan: vi.fn(),
  isAchievementScanRunning: vi.fn(),
  MAX_GAMES_PER_USER_CAP: 5000,
  ScanInProgressError: class ScanInProgressError extends Error {},
}))

vi.mock("@/lib/server/rate-limit", () => ({
  rateLimit: vi.fn().mockReturnValue({ success: true, remaining: 5 }),
}))

import { NextRequest } from "next/server"
import { GET, POST } from "@/app/api/cron/achievements-scan/route"
import {
  getLastAchievementScan,
  isAchievementScanRunning,
  runAchievementScan,
  ScanInProgressError,
} from "@/lib/server/achievement-scan"
import { rateLimit } from "@/lib/server/rate-limit"

const SECRET = "0123456789abcdef0123456789abcdef"
const URL = "http://localhost/api/cron/achievements-scan"

function post(body?: string, token?: string) {
  return new NextRequest(URL, {
    method: "POST",
    body,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token !== undefined ? { authorization: `Bearer ${token}` } : {}),
    },
  })
}

function get(token?: string) {
  return new NextRequest(URL, { headers: token !== undefined ? { authorization: `Bearer ${token}` } : {} })
}

const sampleResult = {
  startedAt: "2026-09-15T06:00:00.000Z",
  finishedAt: "2026-09-15T06:01:00.000Z",
  durationMs: 60000,
  usersScanned: 1,
  gamesScanned: 42,
  changesDetected: 2,
  failures: 0,
  users: [],
  notifications: { discord: "skipped" as const, telegram: "skipped" as const },
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET
  vi.mocked(runAchievementScan).mockReset().mockResolvedValue(sampleResult)
  vi.mocked(isAchievementScanRunning).mockReset().mockReturnValue(false)
  vi.mocked(getLastAchievementScan).mockReset().mockReturnValue(null)
  vi.mocked(rateLimit).mockReset().mockReturnValue({ success: true, remaining: 5 })
})

afterEach(() => {
  delete process.env.CRON_SECRET
})

describe("auth", () => {
  it("returns 503 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET
    expect((await POST(post(undefined, SECRET))).status).toBe(503)
    expect((await GET(get(SECRET))).status).toBe(503)
    expect(runAchievementScan).not.toHaveBeenCalled()
  })

  it("returns 401 without a token, with a wrong token, or with a wrong scheme", async () => {
    expect((await POST(post())).status).toBe(401)
    expect((await POST(post(undefined, "nope"))).status).toBe(401)
    expect((await POST(post(undefined, SECRET.slice(0, -1) + "x"))).status).toBe(401)
    const basic = new NextRequest(URL, { method: "POST", headers: { authorization: `Basic ${SECRET}` } })
    expect((await POST(basic)).status).toBe(401)
    expect((await GET(get())).status).toBe(401)
    expect(runAchievementScan).not.toHaveBeenCalled()
  })
})

describe("POST /api/cron/achievements-scan", () => {
  it("runs the scan and returns its result", async () => {
    const response = await POST(post(undefined, SECRET))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(sampleResult)
    expect(runAchievementScan).toHaveBeenCalledWith({ maxGamesPerUser: undefined })
  })

  it("passes maxGamesPerUser through", async () => {
    const response = await POST(post(JSON.stringify({ maxGamesPerUser: 200 }), SECRET))
    expect(response.status).toBe(200)
    expect(runAchievementScan).toHaveBeenCalledWith({ maxGamesPerUser: 200 })
  })

  it("rejects malformed or out-of-range bodies", async () => {
    for (const body of [
      "{nope",
      "[]",
      "null",
      JSON.stringify({ maxGamesPerUser: 0 }),
      JSON.stringify({ maxGamesPerUser: 1.5 }),
      JSON.stringify({ maxGamesPerUser: 5001 }),
      JSON.stringify({ maxGamesPerUser: "10" }),
    ]) {
      const response = await POST(post(body, SECRET))
      expect(response.status).toBe(400)
    }
    expect(runAchievementScan).not.toHaveBeenCalled()
  })

  it("returns 409 while a scan is running", async () => {
    vi.mocked(isAchievementScanRunning).mockReturnValue(true)
    const response = await POST(post(undefined, SECRET))
    expect(response.status).toBe(409)
    expect(runAchievementScan).not.toHaveBeenCalled()
  })

  it("returns 409 when another process holds the scan lease", async () => {
    vi.mocked(runAchievementScan).mockRejectedValue(new ScanInProgressError())
    const response = await POST(post(undefined, SECRET))
    expect(response.status).toBe(409)
  })

  it("returns 429 when rate limited", async () => {
    vi.mocked(rateLimit).mockReturnValue({ success: false, remaining: 0 })
    const response = await POST(post(undefined, SECRET))
    expect(response.status).toBe(429)
    expect(runAchievementScan).not.toHaveBeenCalled()
  })

  it("returns 500 when the scan throws", async () => {
    vi.mocked(runAchievementScan).mockRejectedValue(new Error("boom"))
    const response = await POST(post(undefined, SECRET))
    expect(response.status).toBe(500)
  })
})

describe("GET /api/cron/achievements-scan", () => {
  it("reports running state and the last run", async () => {
    vi.mocked(isAchievementScanRunning).mockReturnValue(true)
    vi.mocked(getLastAchievementScan).mockReturnValue({
      startedAt: sampleResult.startedAt,
      finishedAt: null,
      usersScanned: 0,
      gamesScanned: 0,
      changesDetected: 0,
      failures: 0,
    })
    const response = await GET(get(SECRET))
    expect(response.status).toBe(200)
    const body = (await response.json()) as { running: boolean; lastRun: { finishedAt: string | null } }
    expect(body.running).toBe(true)
    expect(body.lastRun.finishedAt).toBeNull()
  })
})
