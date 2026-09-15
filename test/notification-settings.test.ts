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

const WEBHOOK = "https://discord.com/api/webhooks/123456/abcdefghijklmnop-QRS"
const TOKEN = "123456789:AAAAbbbbCCCCddddEEEEffffGGGG"
let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sbh-settings-test-"))
  process.env.SQLITE_PATH = join(tmpDir, "test.sqlite")
  process.env.STEAM_API_KEY = "test-api-key"
  process.env.SESSION_SECRET = "test-session-secret"
  vi.resetModules()
})

afterEach(() => {
  delete process.env.SQLITE_PATH
  rmSync(tmpDir, { recursive: true, force: true })
})

describe("secret-box", () => {
  it("round-trips and never stores the plaintext", async () => {
    const { encryptSecret, decryptSecret } = await import("@/lib/server/secret-box")
    const sealed = encryptSecret(TOKEN)
    expect(sealed.startsWith("v1:")).toBe(true)
    expect(sealed).not.toContain(TOKEN)
    expect(decryptSecret(sealed)).toBe(TOKEN)
    expect(encryptSecret(TOKEN)).not.toBe(sealed) // fresh IV each time
  })

  it("returns null for malformed input or a value sealed under another key", async () => {
    const { encryptSecret } = await import("@/lib/server/secret-box")
    const sealed = encryptSecret(TOKEN)

    process.env.SESSION_SECRET = "rotated"
    vi.resetModules()
    const { decryptSecret } = await import("@/lib/server/secret-box")
    expect(decryptSecret(sealed)).toBeNull()
    expect(decryptSecret("garbage")).toBeNull()
    expect(decryptSecret(null)).toBeNull()
  })
})

describe("notification settings", () => {
  it("defaults to everything disabled and unconfigured", async () => {
    const { getNotificationSettings, getNotificationSettingsView } = await import("@/lib/server/notification-settings")
    expect(getNotificationSettings()).toEqual({
      discord: { enabled: false, webhookUrl: null },
      telegram: { enabled: false, botToken: null, chatId: null, threadId: null },
      updatedAt: null,
    })
    expect(getNotificationSettingsView().discord.webhookConfigured).toBe(false)
  })

  it("saves, encrypts secrets at rest, and masks them in the view", async () => {
    const { saveNotificationSettings, getNotificationSettings } = await import("@/lib/server/notification-settings")
    const view = saveNotificationSettings({
      discord: { enabled: true, webhookUrl: WEBHOOK },
      telegram: { enabled: true, botToken: TOKEN, chatId: "-1001234567890", threadId: "42" },
    })

    expect(view.discord).toEqual({ enabled: true, webhookConfigured: true, webhookHint: "…-QRS" })
    expect(view.telegram).toMatchObject({
      enabled: true,
      botTokenConfigured: true,
      botTokenHint: "…GGGG",
      chatId: "-1001234567890",
      threadId: "42",
    })
    expect(view.updatedAt).not.toBeNull()
    expect(JSON.stringify(view)).not.toContain(TOKEN)

    const { getSqliteDatabase } = await import("@/lib/server/sqlite")
    const row = getSqliteDatabase().prepare("SELECT * FROM notification_settings WHERE id = 1").get() as Record<
      string,
      string
    >
    expect(row.discord_webhook_url_enc).not.toContain("discord.com")
    expect(row.telegram_bot_token_enc).not.toContain(TOKEN)

    expect(getNotificationSettings()).toMatchObject({
      discord: { enabled: true, webhookUrl: WEBHOOK },
      telegram: { enabled: true, botToken: TOKEN, chatId: "-1001234567890", threadId: "42" },
    })
  })

  it("keeps stored secrets when the form sends them blank, and clears an empty thread id", async () => {
    const { saveNotificationSettings, getNotificationSettings } = await import("@/lib/server/notification-settings")
    saveNotificationSettings({
      discord: { enabled: true, webhookUrl: WEBHOOK },
      telegram: { enabled: true, botToken: TOKEN, chatId: "123", threadId: "7" },
    })
    saveNotificationSettings({
      discord: { enabled: false, webhookUrl: "" },
      telegram: { enabled: true, botToken: "", chatId: "456", threadId: "" },
    })
    expect(getNotificationSettings()).toMatchObject({
      discord: { enabled: false, webhookUrl: WEBHOOK },
      telegram: { enabled: true, botToken: TOKEN, chatId: "456", threadId: null },
    })
  })

  it("refuses to enable a channel without its secrets", async () => {
    const { saveNotificationSettings, NotificationSettingsError } = await import("@/lib/server/notification-settings")
    expect(() => saveNotificationSettings({ discord: { enabled: true }, telegram: { enabled: false } })).toThrow(
      NotificationSettingsError,
    )
    expect(() =>
      saveNotificationSettings({ discord: { enabled: false }, telegram: { enabled: true, botToken: TOKEN } }),
    ).toThrow(/chat id/)
  })

  it("validates formats and rejects malformed bodies", async () => {
    const { saveNotificationSettings } = await import("@/lib/server/notification-settings")
    const bad = [
      { discord: { enabled: false, webhookUrl: "https://example.com/hook" }, telegram: { enabled: false } },
      { discord: { enabled: false }, telegram: { enabled: false, botToken: "nope" } },
      { discord: { enabled: false }, telegram: { enabled: false, chatId: "abc" } },
      { discord: { enabled: false }, telegram: { enabled: false, threadId: "x" } },
      { discord: { enabled: "yes" }, telegram: { enabled: false } },
      null,
      [],
    ]
    for (const input of bad) {
      expect(() => saveNotificationSettings(input)).toThrow()
    }
  })

  it("reads a secret sealed under a rotated key as not configured", async () => {
    const { saveNotificationSettings } = await import("@/lib/server/notification-settings")
    saveNotificationSettings({ discord: { enabled: true, webhookUrl: WEBHOOK }, telegram: { enabled: false } })

    process.env.SESSION_SECRET = "rotated"
    vi.resetModules()
    const { getNotificationSettingsView } = await import("@/lib/server/notification-settings")
    const view = getNotificationSettingsView()
    expect(view.discord.enabled).toBe(true)
    expect(view.discord.webhookConfigured).toBe(false)
  })
})
