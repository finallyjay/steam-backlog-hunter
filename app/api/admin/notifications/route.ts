import { NextResponse } from "next/server"

import { requireAdmin } from "@/app/lib/require-admin"
import {
  getNotificationSettingsView,
  NotificationSettingsError,
  saveNotificationSettings,
} from "@/lib/server/notification-settings"
import { logger } from "@/lib/server/logger"

/**
 * GET /api/admin/notifications
 *
 * Returns the outbound notification settings in masked form: enabled flags,
 * plain fields (chat id, thread id) and a short hint of each stored secret.
 * Secrets themselves are never returned.
 *
 * @returns {{ settings: NotificationSettingsView }}
 * @throws 403 - Not admin
 * @throws 500 - Server error
 */
export async function GET() {
  try {
    const admin = await requireAdmin()
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    return NextResponse.json({ settings: getNotificationSettingsView() })
  } catch (error) {
    logger.error({ err: error }, "Load notification settings error")
    return NextResponse.json({ error: "Failed to load notification settings" }, { status: 500 })
  }
}

/**
 * PUT /api/admin/notifications
 *
 * Saves outbound notification settings. Secrets are replace-if-present: an
 * empty or omitted `webhookUrl` / `botToken` keeps the stored value.
 *
 * @body discord - `{ enabled: boolean, webhookUrl?: string }`
 * @body telegram - `{ enabled: boolean, botToken?: string, chatId?: string, threadId?: string | null }`
 * @returns {{ settings: NotificationSettingsView }} Saved settings, masked
 * @throws 400 - Invalid body or enabling a channel without its secrets
 * @throws 403 - Not admin
 * @throws 500 - Server error
 */
export async function PUT(request: Request) {
  try {
    const admin = await requireAdmin()
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    try {
      const settings = saveNotificationSettings(body)
      logger.info(
        { discord: settings.discord.enabled, telegram: settings.telegram.enabled },
        "Notification settings saved",
      )
      return NextResponse.json({ settings })
    } catch (error) {
      if (error instanceof NotificationSettingsError) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      throw error
    }
  } catch (error) {
    logger.error({ err: error }, "Save notification settings error")
    return NextResponse.json({ error: "Failed to save notification settings" }, { status: 500 })
  }
}
