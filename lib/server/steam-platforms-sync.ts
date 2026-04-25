import "server-only"

import { getSqliteDatabase } from "@/lib/server/sqlite"
import { isStale, nowIso } from "@/lib/server/steam-store-utils"
import { logger } from "@/lib/server/logger"

export type GamePlatforms = {
  windows: boolean
  mac: boolean
  linux: boolean
}

const PLATFORMS_STALE_MS = 30 * 24 * 60 * 60 * 1000

// Same delay as hydrateMissingExtraNames — single-appid calls only, ~150ms
// keeps us safely under Steam's community-measured ~200req/5min ceiling.
const STORE_DELAY_MS = 150

// Hard ceiling per sync run so a one-time first pass on a 3000-game library
// doesn't block other syncs for 8 minutes. Anything left over gets picked up
// on the next sync tick.
const MAX_FETCHES_PER_RUN = 200

type StoreAppDetailsPlatforms = {
  success?: boolean
  data?: {
    platforms?: {
      windows?: boolean
      mac?: boolean
      linux?: boolean
    }
  }
}

/**
 * Fetches platform availability (windows/mac/linux) from store appdetails for
 * every appid in the user's library that hasn't been synced in the last 30
 * days. Used to disambiguate same-named games across platforms in the UI
 * (e.g. GTA III for Mac vs Windows have different appids but identical names).
 *
 * Reuses the rate-limit + backoff pattern from `hydrateMissingExtraNames`:
 * sequential calls with 150ms gap, abort after 10 consecutive failures.
 *
 * Negative caching: when appdetails reports `success=false` (delisted, no
 * store page), we still write `platforms_synced_at` with `platforms=NULL` so
 * we don't retry every sync. Truly delisted games render without badges.
 */
export async function syncGamePlatforms(steamId: string) {
  const db = getSqliteDatabase()

  const rows = db
    .prepare(
      `
      SELECT g.appid, g.platforms_synced_at
      FROM games g
      INNER JOIN user_games ug ON ug.appid = g.appid
      WHERE ug.steam_id = ? AND ug.owned = 1
      ORDER BY ug.playtime_forever DESC
      `,
    )
    .all(steamId) as Array<{ appid: number; platforms_synced_at: string | null }>

  const candidates = rows.filter((row) => isStale(row.platforms_synced_at, PLATFORMS_STALE_MS))
  if (candidates.length === 0) return

  const targets = candidates.slice(0, MAX_FETCHES_PER_RUN)

  const upsert = db.prepare(`
    UPDATE games
    SET platforms = ?,
        platforms_synced_at = ?,
        updated_at = ?
    WHERE appid = ?
  `)

  let consecutiveFailures = 0

  for (const { appid } of targets) {
    if (consecutiveFailures >= 10) {
      logger.warn(
        { steamId, remaining: targets.length, lastAppid: appid },
        "Store appdetails returned 10 consecutive failures — backing off syncGamePlatforms",
      )
      return
    }

    let platforms: GamePlatforms | null = null
    let storeRespondedCleanly = false

    try {
      const url = new URL("https://store.steampowered.com/api/appdetails")
      url.searchParams.set("appids", String(appid))
      url.searchParams.set("filters", "basic")
      const response = await fetch(url.toString(), { cache: "no-store" })

      if (!response.ok) {
        consecutiveFailures++
      } else {
        consecutiveFailures = 0
        const payload = (await response.json()) as Record<string, StoreAppDetailsPlatforms>
        const entry = payload[String(appid)]
        if (entry?.success && entry.data?.platforms) {
          storeRespondedCleanly = true
          platforms = {
            windows: Boolean(entry.data.platforms.windows),
            mac: Boolean(entry.data.platforms.mac),
            linux: Boolean(entry.data.platforms.linux),
          }
        } else if (entry && entry.success === false) {
          // Delisted / unknown to the store. Cache as null so we don't retry.
          storeRespondedCleanly = true
        }
      }
    } catch (error) {
      consecutiveFailures++
      logger.warn({ err: error, appid }, "Store appdetails platforms call failed")
    }

    if (storeRespondedCleanly) {
      const now = nowIso()
      upsert.run(platforms ? JSON.stringify(platforms) : null, now, now, appid)
    }

    await new Promise((resolve) => setTimeout(resolve, STORE_DELAY_MS))
  }
}
