// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

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

const ORIGINAL_FETCH = globalThis.fetch
const STEAM_ID = "76561198023709299"
const WEBHOOK = "https://discord.com/api/webhooks/123456/abcdefghijklmnop-QRS"
const TOKEN = "123456789:AAAAbbbbCCCCddddEEEEffffGGGG"
let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sbh-notify-test-"))
  process.env.SQLITE_PATH = join(tmpDir, "test.sqlite")
  process.env.STEAM_API_KEY = "test-api-key"
  process.env.SESSION_SECRET = "test-session-secret"
  vi.resetModules()
})

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  delete process.env.SQLITE_PATH
  rmSync(tmpDir, { recursive: true, force: true })
  vi.clearAllMocks()
})

const summary = {
  startedAt: "2026-09-15T06:00:00.000Z",
  durationMs: 27714,
  gamesScanned: 452,
  changesDetected: 2,
  failures: 0,
}

function line(overrides: Partial<import("@/lib/server/scan-notifier").ScanChangeLine>) {
  return { personaName: "Jay", gameName: "Portal 2", added: 1, removed: 0, wasPerfect: false, ...overrides }
}

async function seedChanges() {
  const { getSqliteDatabase } = await import("@/lib/server/sqlite")
  const db = getSqliteDatabase()
  const now = "2026-09-15T06:00:10.000Z"
  db.prepare(`INSERT INTO steam_profile (steam_id, persona_name, created_at, updated_at) VALUES (?, 'Jay', ?, ?)`).run(
    STEAM_ID,
    now,
    now,
  )
  db.prepare(`INSERT INTO games (appid, name, created_at, updated_at) VALUES (620, 'Portal 2', ?, ?)`).run(now, now)
  db.prepare(`INSERT INTO games (appid, name, created_at, updated_at) VALUES (730, 'CS2', ?, ?)`).run(now, now)
  const insert = db.prepare(
    `INSERT INTO achievement_changes (steam_id, appid, added, removed, total_before, total_after, was_perfect, detected_at, scan_started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  insert.run(STEAM_ID, 730, '["X"]', "[]", 3, 4, 0, now, summary.startedAt)
  insert.run(STEAM_ID, 620, '["A","B"]', '["OLD"]', 2, 3, 1, now, summary.startedAt)
  // A previous scan's change must not be included…
  insert.run(STEAM_ID, 730, '["Z"]', "[]", 2, 3, 0, "2026-09-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z")
  // …nor one an in-app sync recorded while this scan was running.
  insert.run(STEAM_ID, 620, '["MANUAL"]', "[]", 3, 4, 0, now, null)
  return db
}

async function configure(input: {
  discord?: { enabled: boolean; webhookUrl?: string }
  telegram?: { enabled: boolean; botToken?: string; chatId?: string; threadId?: string | null }
}) {
  const { saveNotificationSettings } = await import("@/lib/server/notification-settings")
  saveNotificationSettings({
    discord: input.discord ?? { enabled: false },
    telegram: input.telegram ?? { enabled: false },
  })
}

function captureFetch(handler?: (url: string) => Response | Promise<Response>) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = []
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> })
    return handler ? handler(url) : ({ ok: true, status: 200 } as Response)
  }) as unknown as typeof fetch
  return calls
}

describe("buildScanNotification", () => {
  it("formats a header, one line per change and a footer", async () => {
    const { buildScanNotification } = await import("@/lib/server/scan-notifier")
    const text = buildScanNotification(
      summary,
      [line({ gameName: "Portal 2", added: 2, removed: 1, wasPerfect: true }), line({ gameName: "CS2", added: 1 })],
      2000,
    )
    expect(text).toBe(
      [
        "🏆 Steam Backlog Hunter: 2 achievement changes detected",
        "• Portal 2: +2 new, 1 retired, was 100%",
        "• CS2: +1 new",
        "Scanned 452 games in 28s.",
      ].join("\n"),
    )
  })

  it("adds player names only when changes span several accounts, and reports sync failures", async () => {
    const { buildScanNotification } = await import("@/lib/server/scan-notifier")
    const text = buildScanNotification(
      { ...summary, changesDetected: 1, failures: 3 },
      [line({ personaName: "Jay" }), line({ personaName: "Ana", gameName: "CS2" })],
      2000,
    )
    expect(text).toContain("• Portal 2 (Jay): +1 new")
    expect(text).toContain("• CS2 (Ana): +1 new")
    expect(text).toContain("1 achievement change detected")
    expect(text).toContain("3 games failed to sync")
  })

  it("stays under the channel limit by collapsing the tail into a count", async () => {
    const { buildScanNotification } = await import("@/lib/server/scan-notifier")
    const many = Array.from({ length: 200 }, (_, i) => line({ gameName: `Some fairly long game title number ${i}` }))
    const text = buildScanNotification({ ...summary, changesDetected: 200 }, many, 2000)
    expect(text.length).toBeLessThanOrEqual(2000)
    expect(text).toMatch(/… and \d+ more/)
    expect(text.endsWith("Scanned 452 games in 28s.")).toBe(true)
  })
})

describe("listChangesForScan", () => {
  it("returns only this scan's changes with names, perfect games first", async () => {
    await seedChanges()
    const { listChangesForScan } = await import("@/lib/server/scan-notifier")
    expect(listChangesForScan(summary.startedAt)).toEqual([
      { personaName: "Jay", gameName: "Portal 2", added: 2, removed: 1, wasPerfect: true },
      { personaName: "Jay", gameName: "CS2", added: 1, removed: 0, wasPerfect: false },
    ])
  })
})

describe("notifyScanResult", () => {
  it("skips both channels when nothing is enabled or nothing changed", async () => {
    await seedChanges()
    const calls = captureFetch()
    const { notifyScanResult } = await import("@/lib/server/scan-notifier")

    expect(await notifyScanResult(summary)).toEqual({ discord: "skipped", telegram: "skipped" })

    await configure({ discord: { enabled: true, webhookUrl: WEBHOOK } })
    expect(await notifyScanResult({ ...summary, changesDetected: 0 })).toEqual({
      discord: "skipped",
      telegram: "skipped",
    })
    expect(calls).toHaveLength(0)
  })

  it("posts to every enabled channel with the expected payloads, including the Telegram thread", async () => {
    await seedChanges()
    await configure({
      discord: { enabled: true, webhookUrl: WEBHOOK },
      telegram: { enabled: true, botToken: TOKEN, chatId: "-1001234567890", threadId: "42" },
    })
    const calls = captureFetch()
    const { notifyScanResult } = await import("@/lib/server/scan-notifier")

    expect(await notifyScanResult(summary)).toEqual({ discord: "sent", telegram: "sent" })

    const discord = calls.find((c) => c.url === WEBHOOK)
    expect(discord?.body.content).toContain("• Portal 2: +2 new, 1 retired, was 100%")
    expect(discord?.body.allowed_mentions).toEqual({ parse: [] })

    const telegram = calls.find((c) => c.url === `https://api.telegram.org/bot${TOKEN}/sendMessage`)
    expect(telegram?.body.chat_id).toBe("-1001234567890")
    expect(telegram?.body.message_thread_id).toBe(42)
    expect(telegram?.body.text).toContain("• CS2: +1 new")
  })

  it("omits message_thread_id when no thread is configured and skips disabled channels", async () => {
    await seedChanges()
    await configure({
      discord: { enabled: false, webhookUrl: WEBHOOK },
      telegram: { enabled: true, botToken: TOKEN, chatId: "123" },
    })
    const calls = captureFetch()
    const { notifyScanResult } = await import("@/lib/server/scan-notifier")

    expect(await notifyScanResult(summary)).toEqual({ discord: "skipped", telegram: "sent" })
    expect(calls).toHaveLength(1)
    expect("message_thread_id" in calls[0]!.body).toBe(false)
  })

  it("reports a failed channel without throwing and keeps the other one", async () => {
    await seedChanges()
    await configure({
      discord: { enabled: true, webhookUrl: WEBHOOK },
      telegram: { enabled: true, botToken: TOKEN, chatId: "123" },
    })
    captureFetch((url) => {
      if (url === WEBHOOK) throw new Error("network down")
      return { ok: false, status: 403 } as Response
    })
    const { notifyScanResult } = await import("@/lib/server/scan-notifier")

    expect(await notifyScanResult(summary)).toEqual({ discord: "failed", telegram: "failed" })
  })

  it("sends counts only when change details cannot be loaded", async () => {
    await configure({ discord: { enabled: true, webhookUrl: WEBHOOK } })
    const { getSqliteDatabase } = await import("@/lib/server/sqlite")
    getSqliteDatabase().exec("DROP TABLE achievement_changes")
    const calls = captureFetch()
    const { notifyScanResult } = await import("@/lib/server/scan-notifier")

    expect(await notifyScanResult(summary)).toEqual({ discord: "sent", telegram: "skipped" })
    const content = String(calls[0]?.body.content)
    expect(content).toContain("2 achievement changes detected")
    expect(content).not.toContain("•")
  })
})

describe("notifyScanResult settings failure", () => {
  it("reports both channels as failed when settings cannot be read", async () => {
    const { getSqliteDatabase } = await import("@/lib/server/sqlite")
    getSqliteDatabase().exec("DROP TABLE notification_settings")
    const calls = captureFetch()
    const { notifyScanResult } = await import("@/lib/server/scan-notifier")

    expect(await notifyScanResult(summary)).toEqual({ discord: "failed", telegram: "failed" })
    expect(calls).toHaveLength(0)
  })
})

describe("sendToChannel", () => {
  it("throws when the channel is not configured", async () => {
    const { sendToChannel } = await import("@/lib/server/scan-notifier")
    const { getNotificationSettings } = await import("@/lib/server/notification-settings")
    await expect(sendToChannel("discord", "hi", getNotificationSettings())).rejects.toThrow("not configured")
    await expect(sendToChannel("telegram", "hi", getNotificationSettings())).rejects.toThrow("not configured")
  })
})
