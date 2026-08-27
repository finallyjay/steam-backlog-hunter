// This module talks to the Steam Web API and logs through the server-only
// pino logger, so it is marked `server-only`. Client components only ever
// import *types* from here (e.g. `SteamGame`), which TypeScript erases at
// compile time — there is no runtime import — so the boundary holds and the
// build stays green. Runtime helpers a client needs (CDN URL builders) live
// in the client-safe `lib/steam-image-urls` module instead.
import "server-only"

import { createHash } from "node:crypto"

import { logger } from "@/lib/server/logger"

/**
 * Steam IDs are personal identifiers, so never log them raw (CWE-532). This
 * returns a short, stable hash that's enough to correlate log lines for the
 * same account without exposing the id itself.
 */
function redactSteamId(steamId: string): string {
  return `sid_${createHash("sha256").update(steamId).digest("hex").slice(0, 10)}`
}

export interface SteamGame {
  appid: number
  name: string
  playtime_forever: number
  playtime_2weeks?: number
  img_icon_url: string
  img_logo_url: string
  image_icon_url?: string
  image_landscape_url?: string
  image_portrait_url?: string
  rtime_last_played?: number
  rtime_first_played?: number
  has_community_visible_stats?: boolean
  unlocked_count?: number
  total_count?: number
  perfect_game?: boolean
  platforms?: { windows: boolean; mac: boolean; linux: boolean } | null
  releaseYear?: number | null
}

export interface SteamAchievement {
  apiname: string
  achieved: number
  unlocktime: number
  name?: string
  description?: string
}

export interface GameAchievements {
  steamID: string
  gameName: string
  achievements: SteamAchievement[]
  success: boolean
}

export interface PlayerStats {
  steamID: string
  gameName: string
  achievements: SteamAchievement[]
  stats: Array<{
    name: string
    value: number
  }>
  success: boolean
}

/** Single achievement entry as returned by ISteamUserStats/GetSchemaForGame. */
export interface SchemaAchievement {
  name: string
  displayName?: string
  description?: string
  icon?: string
  icongray?: string
  hidden?: number
  defaultvalue?: number
}

/**
 * Game schema as returned by ISteamUserStats/GetSchemaForGame, after the
 * `{ game: ... }` envelope is unwrapped. Used for both achievement metadata
 * (display names, icons) and as a name-resolution fallback for delisted apps
 * via `gameName`.
 */
export interface GameSchema {
  gameName?: string
  gameVersion?: string
  availableGameStats?: {
    achievements?: SchemaAchievement[]
    stats?: Array<{
      name: string
      defaultvalue?: number
      displayName?: string
    }>
  }
}

const STEAM_API_BASE = "https://api.steampowered.com"

/**
 * Locale passed to Steam as the `l=` parameter (localizes game names,
 * achievement text, etc). Defaults to Spanish to preserve historical
 * behaviour; override with STEAM_API_LOCALE (e.g. "en", "fr", "de").
 */
function steamLocale(): string {
  return process.env.STEAM_API_LOCALE || "es"
}

// Rate-limit backoff tuning. Steam returns HTTP 429 when Valve throttles the
// key — common during the heavy owned-games sync, which fans out hundreds of
// per-app achievement/schema calls. Without a retry those blips silently turn
// into empty results (getOwnedGames → []), so we retry with exponential
// backoff, honouring the Retry-After header when Valve sends one.
const MAX_STEAM_RETRIES = 3
const BASE_BACKOFF_MS = 1_000
// Caps ONLY the exponential fallback delay — never a server-provided
// Retry-After (that must be honoured in full, see nextBackoffMs).
const MAX_BACKOFF_MS = 30_000
// Ceiling on how long we'll actually hold a request open waiting out a
// Retry-After. Beyond this it's cheaper to fail fast (return the rate-limit
// error) than to sleep for minutes — and retrying *before* the window closes
// would just hit the same throttle again.
const MAX_RETRY_AFTER_WAIT_MS = 60_000
// Ceiling on the TOTAL time a single request will spend sleeping across all
// of its retries. MAX_RETRY_AFTER_WAIT_MS only bounds each individual wait —
// with MAX_STEAM_RETRIES=3, three back-to-back ~60s Retry-After waits could
// still hold a request handler open for minutes, well past typical proxy/
// gateway timeouts. This budget makes the request-handler-visible latency
// predictable regardless of how many retries Valve's Retry-After values add
// up to.
const MAX_TOTAL_RETRY_WAIT_MS = 60_000

class SteamAPIError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message)
    this.name = "SteamAPIError"
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Parses a `Retry-After` header into milliseconds. Steam may send either a
 * delay in seconds ("120") or an HTTP-date. Returns null when the header is
 * absent or unparseable so the caller can fall back to exponential backoff.
 */
function parseRetryAfterMs(header: string | null | undefined): number | null {
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000)
  const dateMs = Date.parse(header)
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now())
  return null
}

/**
 * Delay (ms) to wait before the next 429 retry, or `null` to stop retrying.
 *
 * - A valid Retry-After is honoured *in full* (never capped to MAX_BACKOFF_MS)
 *   as long as it's within MAX_RETRY_AFTER_WAIT_MS. Capping it would retry
 *   while Valve is still throttling us and burn the remaining attempts early.
 * - A Retry-After beyond that ceiling returns `null`: give up now rather than
 *   retry too soon or hold the request open for minutes.
 * - Without Retry-After, fall back to capped exponential backoff.
 */
function nextBackoffMs(attempt: number, retryAfterHeader: string | null | undefined): number | null {
  const retryAfter = parseRetryAfterMs(retryAfterHeader)
  if (retryAfter !== null) {
    return retryAfter <= MAX_RETRY_AFTER_WAIT_MS ? retryAfter : null
  }
  return Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS)
}

async function steamAPIRequest(endpoint: string, params: Record<string, string>) {
  const apiKey = process.env.STEAM_API_KEY
  if (!apiKey) {
    throw new SteamAPIError("STEAM_API_KEY is not configured", 500)
  }

  const url = new URL(`${STEAM_API_BASE}${endpoint}`)
  url.searchParams.set("key", apiKey)
  url.searchParams.set("format", "json")

  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value)
  })

  for (let attempt = 0, totalWaitMs = 0; ; attempt++) {
    try {
      const response = await fetch(url.toString(), {
        cache: "no-store",
      })

      // Explicit rate-limit handling: back off and retry rather than letting
      // Valve's throttle surface as a generic failure the callers swallow.
      if (response.status === 429) {
        const retryAfterHeader = response.headers?.get?.("retry-after")
        const delay = attempt < MAX_STEAM_RETRIES ? nextBackoffMs(attempt, retryAfterHeader) : null
        // Beyond the per-attempt ceiling above, also cap the *cumulative*
        // sleep across all attempts (MAX_TOTAL_RETRY_WAIT_MS) — otherwise a
        // request handler could stay open for minutes across several
        // large-but-individually-valid Retry-After waits.
        if (delay !== null && totalWaitMs + delay <= MAX_TOTAL_RETRY_WAIT_MS) {
          logger.warn(
            { endpoint, attempt: attempt + 1, delayMs: delay, retryAfter: retryAfterHeader ?? null },
            "Steam API rate limited (429) — backing off before retry",
          )
          await sleep(delay)
          totalWaitMs += delay
          continue
        }
        logger.error(
          { endpoint, attempts: attempt + 1, retryAfter: retryAfterHeader ?? null },
          "Steam API rate limited (429) — giving up (retries exhausted, Retry-After too long, or retry budget exhausted)",
        )
        throw new SteamAPIError(`Steam API rate limited: 429`, 429)
      }

      if (!response.ok) {
        throw new SteamAPIError(`Steam API request failed: ${response.status}`, response.status)
      }

      return await response.json()
    } catch (error) {
      if (error instanceof SteamAPIError) {
        throw error
      }
      throw new SteamAPIError(`Network error: ${error instanceof Error ? error.message : "Unknown error"}`)
    }
  }
}

/** Fetches all owned games (including free-to-play and unvetted playtests) for a Steam user. */
export async function getOwnedGames(steamId: string): Promise<SteamGame[]> {
  try {
    const data = await steamAPIRequest("/IPlayerService/GetOwnedGames/v1/", {
      steamid: steamId,
      include_appinfo: "1",
      include_played_free_games: "1",
      // skip_unvetted_apps=0 pulls in playtests and early-access experiments
      // that Steam normally hides (e.g. SquadBlast Playtest, ForeVR Cornhole).
      skip_unvetted_apps: "0",
      l: steamLocale(),
    })

    return data.response?.games || []
  } catch (error) {
    logger.error({ err: error, steamIdHash: redactSteamId(steamId) }, "Error fetching owned games")
    return []
  }
}

/**
 * Thrown by {@link getPlayerAchievements} when a request fails in a way that
 * says nothing about whether the game actually has stats — rate limiting
 * exhausted (429), a Steam-side server error (5xx), or a network failure.
 *
 * Unlike the definitive "no stats" case (a plain `null` return — see below),
 * callers must NOT treat this as "this game has no achievements": doing so
 * would cache that false conclusion for up to 7 days (ACHIEVEMENTS_STALE_MS)
 * over what is most likely a momentary blip. Callers should catch this,
 * avoid persisting anything, and let the next sync retry — see
 * `getAchievementsForGame` in steam-achievements-sync.ts, the per-game
 * workers in steam-stats-compute.ts and extra-games.ts, and
 * ensurePinnedGamesSynced in pinned-games.ts.
 */
export class TransientSteamAPIError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = "TransientSteamAPIError"
  }
}

/**
 * Fetches a player's achievements for a specific game, or `null` when Steam
 * gives a *definitive* answer that the game has no stats (400/403, or a 200
 * response with `success: false`).
 *
 * @throws {TransientSteamAPIError} on rate-limit exhaustion (429), a Steam
 *   server error (5xx), or a network failure — none of those mean "no
 *   achievements", so they must not be conflated with the null case above.
 */
export async function getPlayerAchievements(steamId: string, appId: number): Promise<GameAchievements | null> {
  try {
    const data = await steamAPIRequest("/ISteamUserStats/GetPlayerAchievements/v1/", {
      steamid: steamId,
      appid: appId.toString(),
      l: steamLocale(),
    })

    if (!data.playerstats?.success) {
      return null
    }

    return {
      steamID: data.playerstats.steamID,
      gameName: data.playerstats.gameName,
      achievements: data.playerstats.achievements || [],
      success: data.playerstats.success,
    }
  } catch (error) {
    // Steam returns 400/403 for games that simply don't publish stats (very
    // common for older titles, DLC-only entries, stats-only games, etc).
    // That's the signal the caller expects — a null return value — so don't
    // spam the console with "errors" for the normal case.
    if (error instanceof SteamAPIError && (error.status === 400 || error.status === 403)) {
      return null
    }
    // Everything else — 429 with retries exhausted, 5xx, or a network
    // failure — is transient: it says nothing about whether the game has
    // achievements, so it must not be swallowed into the null case above.
    logger.warn({ err: error, appId }, "Transient error fetching achievements — will retry on next sync")
    throw new TransientSteamAPIError("Transient error fetching player achievements", error)
  }
}

export interface LastPlayedGame {
  appid: number
  playtime_forever?: number
  playtime_2weeks?: number
  first_playtime?: number
  last_playtime?: number
}

/**
 * Fetches the "last played times" log for a Steam user via the undocumented
 * `IPlayerService/ClientGetLastPlayedTimes/v1/` endpoint.
 *
 * This returns playtime data for **every** game the account has ever played —
 * including delisted apps (FaceRig, Free to Play, …) that `GetOwnedGames`
 * silently drops. Unlike `GetOwnedGames`, the response also contains
 * `first_playtime`, which isn't exposed anywhere else in the Web API.
 */
export async function getLastPlayedTimes(steamId: string): Promise<LastPlayedGame[]> {
  try {
    const data = (await steamAPIRequest("/IPlayerService/ClientGetLastPlayedTimes/v1/", {
      steamid: steamId,
      min_last_played: "0",
    })) as { response?: { games?: LastPlayedGame[] } }

    return data.response?.games ?? []
  } catch (error) {
    if (error instanceof SteamAPIError && (error.status === 400 || error.status === 403)) {
      return []
    }
    logger.error({ err: error, steamIdHash: redactSteamId(steamId) }, "Error fetching last played times")
    return []
  }
}

/** One entry of ISteamUserStats/GetGlobalAchievementPercentagesForApp. */
export interface GlobalAchievementPercent {
  name: string
  percent: number
}

/**
 * Fetches the global unlock percentage for every achievement of a game.
 *
 * Calls ISteamUserStats/GetGlobalAchievementPercentagesForApp, which is public
 * (no API key scope needed — Valve serves it to the community widgets). Returns
 * null on 400/403/404/network errors so the caller can treat "no rarity data"
 * as a first-class case alongside "no schema".
 */
export async function getGlobalAchievementPercentages(appId: number): Promise<GlobalAchievementPercent[] | null> {
  try {
    const data = await steamAPIRequest("/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/", {
      gameid: appId.toString(),
    })
    const arr = data?.achievementpercentages?.achievements
    if (!Array.isArray(arr)) return null
    // Steam serves `percent` as a string ("82.3"), not a number, so coerce via
    // Number() and drop non-finite results (malformed rows or NaN).
    const result: GlobalAchievementPercent[] = []
    for (const entry of arr as Array<{ name?: unknown; percent?: unknown }>) {
      if (typeof entry.name !== "string") continue
      const percent = typeof entry.percent === "number" ? entry.percent : Number(entry.percent)
      if (!Number.isFinite(percent)) continue
      result.push({ name: entry.name, percent })
    }
    return result
  } catch (error) {
    if (error instanceof SteamAPIError && (error.status === 400 || error.status === 403 || error.status === 404)) {
      return null
    }
    logger.warn({ err: error, appId }, "Unexpected error fetching global achievement percentages")
    return null
  }
}

/** Fetches the game schema (achievement and stat definitions) from the Steam API. */
export async function getGameSchema(appId: number): Promise<GameSchema | null> {
  try {
    const data = await steamAPIRequest("/ISteamUserStats/GetSchemaForGame/v2/", {
      appid: appId.toString(),
    })

    return (data.game as GameSchema | undefined) ?? null
  } catch (error) {
    // Same story as getPlayerAchievements: 400/403 just means the app has no
    // publishable schema. Let the caller treat it as an empty schema without
    // lighting up the console.
    if (error instanceof SteamAPIError && (error.status === 400 || error.status === 403)) {
      return null
    }
    logger.error({ err: error, appId }, "Error fetching game schema")
    return null
  }
}

// Pure CDN URL builders live in a client-safe module (this file is
// `server-only`). Re-exported here for existing server-side importers.
export { getSteamImageUrl, getSteamHeaderImageUrl, getSteamPortraitImageUrl } from "@/lib/steam-image-urls"
