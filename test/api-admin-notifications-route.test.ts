// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock("@/app/lib/require-admin", () => ({
  requireAdmin: vi.fn(),
}))

vi.mock("@/lib/server/notification-settings", () => ({
  getNotificationSettings: vi.fn(),
  getNotificationSettingsView: vi.fn(),
  saveNotificationSettings: vi.fn(),
  NotificationSettingsError: class NotificationSettingsError extends Error {},
}))

vi.mock("@/lib/server/scan-notifier", () => ({
  sendToChannel: vi.fn(),
}))

vi.mock("@/lib/server/rate-limit", () => ({
  rateLimit: vi.fn().mockReturnValue({ success: true, remaining: 9 }),
}))

import { GET, PUT } from "@/app/api/admin/notifications/route"
import { POST as TEST } from "@/app/api/admin/notifications/test/route"
import { requireAdmin } from "@/app/lib/require-admin"
import {
  getNotificationSettings,
  getNotificationSettingsView,
  NotificationSettingsError,
  saveNotificationSettings,
} from "@/lib/server/notification-settings"
import { rateLimit } from "@/lib/server/rate-limit"
import { sendToChannel } from "@/lib/server/scan-notifier"

const admin = { steamId: "76561198023709299", displayName: "admin", avatar: "", profileUrl: "" }

const view = {
  discord: { enabled: true, webhookConfigured: true, webhookHint: "…abcd" },
  telegram: { enabled: false, botTokenConfigured: false, botTokenHint: null, chatId: null, threadId: null },
  updatedAt: "2026-09-15T00:00:00.000Z",
}

const settings = {
  discord: { enabled: true, webhookUrl: "https://discord.com/api/webhooks/1/abcd" },
  telegram: { enabled: false, botToken: null, chatId: null, threadId: null },
  updatedAt: "2026-09-15T00:00:00.000Z",
}

function json(body: unknown) {
  return new Request("http://localhost/api/admin/notifications", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function testJson(body: unknown) {
  return new Request("http://localhost/api/admin/notifications/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.mocked(requireAdmin).mockReset().mockResolvedValue(admin)
  vi.mocked(getNotificationSettingsView).mockReset().mockReturnValue(view)
  vi.mocked(getNotificationSettings).mockReset().mockReturnValue(settings)
  vi.mocked(saveNotificationSettings).mockReset().mockReturnValue(view)
  vi.mocked(sendToChannel).mockReset().mockResolvedValue(undefined)
  vi.mocked(rateLimit).mockReset().mockReturnValue({ success: true, remaining: 9 })
})

describe("GET /api/admin/notifications", () => {
  it("returns 403 when not admin", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null)
    expect((await GET()).status).toBe(403)
  })

  it("returns the masked view", async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ settings: view })
  })
})

describe("PUT /api/admin/notifications", () => {
  it("returns 403 when not admin", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null)
    expect((await PUT(json({}))).status).toBe(403)
    expect(saveNotificationSettings).not.toHaveBeenCalled()
  })

  it("rejects malformed JSON", async () => {
    const res = await PUT(new Request("http://localhost/api/admin/notifications", { method: "PUT", body: "{nope" }))
    expect(res.status).toBe(400)
  })

  it("maps validation errors to 400 with the message", async () => {
    vi.mocked(saveNotificationSettings).mockImplementation(() => {
      throw new NotificationSettingsError("Enter a Discord webhook URL before enabling Discord notifications")
    })
    const res = await PUT(json({ discord: { enabled: true }, telegram: { enabled: false } }))
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toMatch(/webhook/)
  })

  it("saves and returns the masked view", async () => {
    const body = {
      discord: { enabled: true, webhookUrl: "https://discord.com/api/webhooks/1/x" },
      telegram: { enabled: false },
    }
    const res = await PUT(json(body))
    expect(res.status).toBe(200)
    expect(saveNotificationSettings).toHaveBeenCalledWith(body)
    expect(await res.json()).toEqual({ settings: view })
  })

  it("returns 500 on unexpected errors", async () => {
    vi.mocked(saveNotificationSettings).mockImplementation(() => {
      throw new Error("disk full")
    })
    expect((await PUT(json({ discord: { enabled: false }, telegram: { enabled: false } }))).status).toBe(500)
  })
})

describe("POST /api/admin/notifications/test", () => {
  it("returns 403 when not admin", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null)
    expect((await TEST(testJson({ channel: "discord" }))).status).toBe(403)
  })

  it("returns 429 when rate limited", async () => {
    vi.mocked(rateLimit).mockReturnValue({ success: false, remaining: 0 })
    expect((await TEST(testJson({ channel: "discord" }))).status).toBe(429)
  })

  it("rejects unknown channels", async () => {
    expect((await TEST(testJson({ channel: "slack" }))).status).toBe(400)
    expect((await TEST(testJson({}))).status).toBe(400)
  })

  it("refuses to test an unconfigured channel", async () => {
    const res = await TEST(testJson({ channel: "telegram" }))
    expect(res.status).toBe(400)
    expect(sendToChannel).not.toHaveBeenCalled()
  })

  it("sends a test message with the saved settings", async () => {
    const res = await TEST(testJson({ channel: "discord" }))
    expect(res.status).toBe(200)
    expect(sendToChannel).toHaveBeenCalledWith("discord", expect.stringContaining("test notification"), settings)
  })

  it("returns 502 when the channel rejects the message", async () => {
    vi.mocked(sendToChannel).mockRejectedValue(new Error("HTTP 404"))
    const res = await TEST(testJson({ channel: "discord" }))
    expect(res.status).toBe(502)
    expect(((await res.json()) as { error: string }).error).toContain("HTTP 404")
  })
})
