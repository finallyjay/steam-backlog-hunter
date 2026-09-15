import "server-only"

import { z } from "zod"

import { getSqliteDatabase } from "@/lib/server/sqlite"
import { decryptSecret, encryptSecret } from "@/lib/server/secret-box"
import { nowIso } from "@/lib/server/steam-store-utils"

/** Decrypted settings for server-side use (never sent to the client). */
export type NotificationSettings = {
  discord: { enabled: boolean; webhookUrl: string | null }
  telegram: { enabled: boolean; botToken: string | null; chatId: string | null; threadId: string | null }
  updatedAt: string | null
}

/** What the admin UI sees: flags, plain fields and a hint of each secret, never the secret itself. */
export type NotificationSettingsView = {
  discord: { enabled: boolean; webhookConfigured: boolean; webhookHint: string | null }
  telegram: {
    enabled: boolean
    botTokenConfigured: boolean
    botTokenHint: string | null
    chatId: string | null
    threadId: string | null
  }
  updatedAt: string | null
}

type Row = {
  discord_enabled: number
  discord_webhook_url_enc: string | null
  telegram_enabled: number
  telegram_bot_token_enc: string | null
  telegram_chat_id: string | null
  telegram_thread_id: string | null
  updated_at: string
}

const DISCORD_WEBHOOK_RE =
  /^https:\/\/(discord\.com|discordapp\.com|ptb\.discord\.com|canary\.discord\.com)\/api\/webhooks\/\d+\/[\w-]+$/
const TELEGRAM_TOKEN_RE = /^\d+:[\w-]{20,}$/
const TELEGRAM_CHAT_ID_RE = /^-?\d{1,20}$/
const TELEGRAM_THREAD_ID_RE = /^\d{1,20}$/

const optionalTrimmed = z
  .string()
  .trim()
  .max(2048)
  .optional()
  .transform((value) => (value === undefined || value === "" ? undefined : value))

/**
 * Payload accepted by `saveNotificationSettings`. Secrets are *replace-if-
 * present*: an omitted or empty `webhookUrl`/`botToken` keeps whatever is
 * stored, so the admin form can be saved without retyping them. `chatId`
 * and `threadId` are plain values; an empty `threadId` clears it.
 */
export const notificationSettingsInputSchema = z.object({
  discord: z.object({
    enabled: z.boolean(),
    webhookUrl: optionalTrimmed.refine((v) => v === undefined || DISCORD_WEBHOOK_RE.test(v), {
      message: "Discord webhook URL must look like https://discord.com/api/webhooks/<id>/<token>",
    }),
  }),
  telegram: z.object({
    enabled: z.boolean(),
    botToken: optionalTrimmed.refine((v) => v === undefined || TELEGRAM_TOKEN_RE.test(v), {
      message: "Telegram bot token must look like 123456789:AAAA…",
    }),
    chatId: optionalTrimmed.refine((v) => v === undefined || TELEGRAM_CHAT_ID_RE.test(v), {
      message: "Telegram chat id must be numeric (negative for groups/channels)",
    }),
    threadId: z
      .string()
      .trim()
      .max(32)
      .nullable()
      .optional()
      .transform((value) => (value === undefined || value === null || value === "" ? null : value))
      .refine((v) => v === null || TELEGRAM_THREAD_ID_RE.test(v), {
        message: "Telegram thread id must be numeric",
      }),
  }),
})

export type NotificationSettingsInput = z.infer<typeof notificationSettingsInputSchema>

export class NotificationSettingsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "NotificationSettingsError"
  }
}

function readRow(): Row | undefined {
  const db = getSqliteDatabase()
  return db.prepare(`SELECT * FROM notification_settings WHERE id = 1`).get() as Row | undefined
}

/** Last characters of a secret, enough for the admin to recognise it. */
function hint(secret: string | null): string | null {
  if (!secret) return null
  return `…${secret.slice(-4)}`
}

/** Decrypted settings. A channel whose secret fails to decrypt reads as not configured. */
export function getNotificationSettings(): NotificationSettings {
  const row = readRow()
  if (!row) {
    return {
      discord: { enabled: false, webhookUrl: null },
      telegram: { enabled: false, botToken: null, chatId: null, threadId: null },
      updatedAt: null,
    }
  }
  return {
    discord: { enabled: row.discord_enabled === 1, webhookUrl: decryptSecret(row.discord_webhook_url_enc) },
    telegram: {
      enabled: row.telegram_enabled === 1,
      botToken: decryptSecret(row.telegram_bot_token_enc),
      chatId: row.telegram_chat_id,
      threadId: row.telegram_thread_id,
    },
    updatedAt: row.updated_at,
  }
}

/** Masked view for the admin UI. */
export function getNotificationSettingsView(): NotificationSettingsView {
  const settings = getNotificationSettings()
  return {
    discord: {
      enabled: settings.discord.enabled,
      webhookConfigured: settings.discord.webhookUrl !== null,
      webhookHint: hint(settings.discord.webhookUrl),
    },
    telegram: {
      enabled: settings.telegram.enabled,
      botTokenConfigured: settings.telegram.botToken !== null,
      botTokenHint: hint(settings.telegram.botToken),
      chatId: settings.telegram.chatId,
      threadId: settings.telegram.threadId,
    },
    updatedAt: settings.updatedAt,
  }
}

/**
 * Validates and persists settings. Enabling a channel requires its secrets
 * to be present (either stored already or supplied in this call).
 *
 * @throws NotificationSettingsError with a user-facing message on invalid input
 */
export function saveNotificationSettings(rawInput: unknown): NotificationSettingsView {
  const parsed = notificationSettingsInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    throw new NotificationSettingsError(parsed.error.issues[0]?.message ?? "Invalid notification settings")
  }
  const input = parsed.data
  const current = getNotificationSettings()

  const webhookUrl = input.discord.webhookUrl ?? current.discord.webhookUrl
  const botToken = input.telegram.botToken ?? current.telegram.botToken
  const chatId = input.telegram.chatId ?? current.telegram.chatId
  const threadId = input.telegram.threadId

  if (input.discord.enabled && !webhookUrl) {
    throw new NotificationSettingsError("Enter a Discord webhook URL before enabling Discord notifications")
  }
  if (input.telegram.enabled && (!botToken || !chatId)) {
    throw new NotificationSettingsError("Enter a Telegram bot token and chat id before enabling Telegram notifications")
  }

  const db = getSqliteDatabase()
  db.prepare(
    `
    INSERT INTO notification_settings (
      id, discord_enabled, discord_webhook_url_enc, telegram_enabled, telegram_bot_token_enc,
      telegram_chat_id, telegram_thread_id, updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      discord_enabled = excluded.discord_enabled,
      discord_webhook_url_enc = excluded.discord_webhook_url_enc,
      telegram_enabled = excluded.telegram_enabled,
      telegram_bot_token_enc = excluded.telegram_bot_token_enc,
      telegram_chat_id = excluded.telegram_chat_id,
      telegram_thread_id = excluded.telegram_thread_id,
      updated_at = excluded.updated_at
  `,
  ).run(
    input.discord.enabled ? 1 : 0,
    webhookUrl ? encryptSecret(webhookUrl) : null,
    input.telegram.enabled ? 1 : 0,
    botToken ? encryptSecret(botToken) : null,
    chatId ?? null,
    threadId,
    nowIso(),
  )

  return getNotificationSettingsView()
}
