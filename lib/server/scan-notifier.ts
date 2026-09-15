import "server-only"

import { getNotificationSettings, type NotificationSettings } from "@/lib/server/notification-settings"
import { getSqliteDatabase } from "@/lib/server/sqlite"
import { parseJson } from "@/lib/server/steam-store-utils"
import { logger } from "@/lib/server/logger"

export type NotificationChannel = "discord" | "telegram"
export type NotificationStatus = "sent" | "failed" | "skipped"

export type ScanNotificationStatus = Record<NotificationChannel, NotificationStatus>

/** Minimal slice of a scan result the notifier needs; avoids a circular import. */
export type ScanSummaryForNotification = {
  startedAt: string
  durationMs: number
  gamesScanned: number
  changesDetected: number
  failures: number
}

export type ScanChangeLine = {
  personaName: string | null
  gameName: string
  added: number
  removed: number
  wasPerfect: boolean
}

// Hard limits of the two APIs. Messages are plain text, so cutting at a
// line boundary is safe.
const DISCORD_MAX_CHARS = 2000
const TELEGRAM_MAX_CHARS = 4096
const REQUEST_TIMEOUT_MS = 10_000

type ChangeRow = {
  persona_name: string | null
  game_name: string
  added: string
  removed: string
  was_perfect: number
}

/**
 * Changes recorded by the scan identified by `scanStartedAt`, joined with
 * game and profile names for display. Rows from an in-app sync that happened
 * to run during the scan carry no scan attribution and are excluded.
 */
export function listChangesForScan(scanStartedAt: string): ScanChangeLine[] {
  const db = getSqliteDatabase()
  const rows = db
    .prepare(
      `
      SELECT p.persona_name, g.name AS game_name, ac.added, ac.removed, ac.was_perfect
      FROM achievement_changes ac
      JOIN games g ON g.appid = ac.appid
      LEFT JOIN steam_profile p ON p.steam_id = ac.steam_id
      WHERE ac.scan_started_at = ?
      ORDER BY ac.was_perfect DESC, g.name COLLATE NOCASE
    `,
    )
    .all(scanStartedAt) as ChangeRow[]

  return rows.map((row) => ({
    personaName: row.persona_name,
    gameName: row.game_name,
    added: (parseJson<string[]>(row.added) ?? []).length,
    removed: (parseJson<string[]>(row.removed) ?? []).length,
    wasPerfect: row.was_perfect === 1,
  }))
}

function describeLine(line: ScanChangeLine, withPersona: boolean): string {
  const parts: string[] = []
  if (line.added > 0) parts.push(`+${line.added} new`)
  if (line.removed > 0) parts.push(`${line.removed} retired`)
  if (line.wasPerfect) parts.push("was 100%")
  const who = withPersona && line.personaName ? ` (${line.personaName})` : ""
  return `• ${line.gameName}${who}: ${parts.join(", ")}`
}

/**
 * Builds the plain-text notification body. Pure, exported for tests.
 *
 * Player names are only included when the changes span more than one
 * account, so a single-user install gets a compact message. Lines that
 * don't fit under `maxChars` are dropped and replaced by a "+N more" note.
 */
export function buildScanNotification(
  summary: ScanSummaryForNotification,
  changes: ScanChangeLine[],
  maxChars: number,
): string {
  const personas = new Set(changes.map((c) => c.personaName ?? ""))
  const withPersona = personas.size > 1
  const plural = summary.changesDetected === 1 ? "" : "s"
  const header = `🏆 Steam Backlog Hunter: ${summary.changesDetected} achievement change${plural} detected`
  const seconds = Math.max(1, Math.round(summary.durationMs / 1000))
  const failureNote =
    summary.failures > 0 ? `, ${summary.failures} game${summary.failures === 1 ? "" : "s"} failed to sync` : ""
  const footer = `Scanned ${summary.gamesScanned} games in ${seconds}s${failureNote}.`

  const lines = changes.map((line) => describeLine(line, withPersona))
  const budget = maxChars - header.length - footer.length - 2 // two newlines
  const kept: string[] = []
  let used = 0
  for (let i = 0; i < lines.length; i++) {
    const remaining = lines.length - i
    const moreNote = remaining > 1 ? `\n… and ${remaining} more` : ""
    const cost = lines[i].length + 1
    // Reserve room for the "+N more" note in case this is the last line we can fit.
    if (used + cost + (remaining > 1 ? moreNote.length : 0) > budget) {
      const leftover = lines.length - kept.length
      if (leftover > 0) kept.push(`… and ${leftover} more`)
      break
    }
    kept.push(lines[i])
    used += cost
  }

  return [header, ...kept, footer].join("\n")
}

async function postJson(url: string, body: unknown): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
}

/**
 * Sends `text` to one channel using the given settings. Throws on delivery
 * failure or when the channel is not configured; callers decide whether
 * that is fatal (admin "send test") or merely logged (scan).
 */
export async function sendToChannel(
  channel: NotificationChannel,
  text: string,
  settings: NotificationSettings,
): Promise<void> {
  if (channel === "discord") {
    const url = settings.discord.webhookUrl
    if (!url) throw new Error("Discord webhook is not configured")
    await postJson(url, { content: text, allowed_mentions: { parse: [] } })
    return
  }

  const { botToken, chatId, threadId } = settings.telegram
  if (!botToken || !chatId) throw new Error("Telegram bot token or chat id is not configured")
  await postJson(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    // Forum-style groups: post into a specific topic (thread) when set.
    ...(threadId ? { message_thread_id: Number(threadId) } : {}),
  })
}

async function deliver(
  channel: NotificationChannel,
  text: string,
  settings: NotificationSettings,
): Promise<NotificationStatus> {
  if (!settings[channel].enabled) return "skipped"
  try {
    await sendToChannel(channel, text, settings)
    return "sent"
  } catch (error) {
    logger.warn({ err: error, channel }, "Scan notification: delivery failed")
    return "failed"
  }
}

/**
 * Sends the scan summary to every enabled channel (see /admin/notifications).
 * Never throws: a delivery failure is logged and reported in the returned
 * status so the scan result (and the cron output) shows it, but the scan
 * itself succeeds.
 */
export async function notifyScanResult(summary: ScanSummaryForNotification): Promise<ScanNotificationStatus> {
  const skipped: ScanNotificationStatus = { discord: "skipped", telegram: "skipped" }
  if (summary.changesDetected === 0) return skipped

  let settings: NotificationSettings
  try {
    settings = getNotificationSettings()
  } catch (error) {
    // Not an intentional skip: the operator may have channels enabled that
    // we simply couldn't read. Surface it as a failure on both.
    logger.error({ err: error }, "Scan notification: could not read settings")
    return { discord: "failed", telegram: "failed" }
  }
  if (!settings.discord.enabled && !settings.telegram.enabled) return skipped

  let changes: ScanChangeLine[] = []
  try {
    changes = listChangesForScan(summary.startedAt)
  } catch (error) {
    logger.warn({ err: error }, "Scan notification: could not load change details; sending counts only")
  }

  const [discord, telegram] = await Promise.all([
    deliver("discord", buildScanNotification(summary, changes, DISCORD_MAX_CHARS), settings),
    deliver("telegram", buildScanNotification(summary, changes, TELEGRAM_MAX_CHARS), settings),
  ])
  logger.info({ discord, telegram, changes: summary.changesDetected }, "Scan notification: dispatched")
  return { discord, telegram }
}
