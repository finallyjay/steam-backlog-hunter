import { NextResponse } from "next/server"

import { requireAdmin } from "@/app/lib/require-admin"
import { getNotificationSettings } from "@/lib/server/notification-settings"
import { rateLimit } from "@/lib/server/rate-limit"
import { sendToChannel, type NotificationChannel } from "@/lib/server/scan-notifier"
import { logger } from "@/lib/server/logger"

const CHANNELS: NotificationChannel[] = ["discord", "telegram"]

/**
 * POST /api/admin/notifications/test
 *
 * Sends a test message to one channel using the *saved* settings, so the
 * admin can confirm a webhook / bot / chat / thread combination works
 * before relying on it. Save first, then test.
 *
 * @body channel - "discord" | "telegram"
 * @ratelimit 10 requests per 10 minutes per admin
 * @returns {{ ok: true }}
 * @throws 400 - Unknown channel, or channel not configured
 * @throws 403 - Not admin
 * @throws 429 - Too many requests
 * @throws 502 - The channel rejected the message
 */
export async function POST(request: Request) {
  try {
    const admin = await requireAdmin()
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const { success } = rateLimit(`notifications-test:${admin.steamId}`, 10, 10 * 60_000)
    if (!success) return NextResponse.json({ error: "Too many requests" }, { status: 429 })

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }
    const channel = (body as { channel?: unknown })?.channel
    if (typeof channel !== "string" || !CHANNELS.includes(channel as NotificationChannel)) {
      return NextResponse.json({ error: 'channel must be "discord" or "telegram"' }, { status: 400 })
    }

    const settings = getNotificationSettings()
    const configured =
      channel === "discord"
        ? Boolean(settings.discord.webhookUrl)
        : Boolean(settings.telegram.botToken && settings.telegram.chatId)
    if (!configured) {
      return NextResponse.json({ error: `Save the ${channel} settings before sending a test` }, { status: 400 })
    }

    try {
      await sendToChannel(
        channel as NotificationChannel,
        "🏆 Steam Backlog Hunter: test notification. If you can read this, the channel works.",
        settings,
      )
    } catch (error) {
      logger.warn({ err: error, channel }, "Notification test failed")
      const detail = error instanceof Error ? error.message : "delivery failed"
      return NextResponse.json({ error: `The ${channel} channel rejected the message (${detail})` }, { status: 502 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    logger.error({ err: error }, "Notification test error")
    return NextResponse.json({ error: "Failed to send test notification" }, { status: 500 })
  }
}
