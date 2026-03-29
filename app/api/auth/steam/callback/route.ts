import { type NextRequest, NextResponse } from "next/server"
import crypto from "node:crypto"
import { cookies } from "next/headers"
import { isSteamIdWhitelisted } from "@/lib/whitelist"
import { logger } from "@/lib/server/logger"

const STEAM_OPENID_URL = "https://steamcommunity.com/openid/login"
const STEAM_ID_REGEX = /^\d{17}$/
const STEAM_CLAIMED_ID_PREFIX = "https://steamcommunity.com/openid/id/"

function getAppUrl(path: string, request: NextRequest): string {
  const baseUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, "")
  if (baseUrl) {
    return `${baseUrl}${path}`
  }
  return new URL(path, request.url).toString()
}

/**
 * GET /api/auth/steam/callback
 *
 * Handles the Steam OpenID callback after the user authenticates with Steam.
 * Validates the CSRF nonce, verifies the OpenID response with Steam's servers,
 * checks the Steam ID against the whitelist, fetches user profile info, and
 * creates an httpOnly session cookie.
 *
 * @query nonce - CSRF nonce for validation (string, required)
 * @query openid.claimed_id - Steam OpenID claimed identity URL (string, required)
 * @query openid.return_to - Return URL for realm validation (string, required)
 * @returns Redirect to /dashboard on success, or /?error=auth_failed|not_whitelisted|auth_error on failure
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const cookieStore = await cookies()

  // --- CSRF nonce validation ---
  const nonce = searchParams.get("nonce")
  const nonceCookie = cookieStore.get("steam_openid_nonce")

  if (!nonce || !nonceCookie?.value || !crypto.timingSafeEqual(Buffer.from(nonce), Buffer.from(nonceCookie.value))) {
    logger.info("Auth failed: invalid or missing nonce")
    cookieStore.delete("steam_openid_nonce")
    return NextResponse.redirect(getAppUrl("/?error=auth_failed", request))
  }

  // Consume the nonce — it's single-use
  cookieStore.delete("steam_openid_nonce")

  // --- Verify the OpenID response with Steam ---
  const params = new URLSearchParams()

  for (const [key, value] of searchParams.entries()) {
    if (key !== "nonce") {
      params.append(key, value)
    }
  }

  params.set("openid.mode", "check_authentication")

  try {
    const verifyResponse = await fetch(STEAM_OPENID_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    })

    const verifyText = await verifyResponse.text()

    if (!verifyText.includes("is_valid:true")) {
      logger.info("Auth failed: Steam OpenID verification rejected")
      return NextResponse.redirect(getAppUrl("/?error=auth_failed", request))
    }

    // --- Validate claimed_id format and extract Steam ID ---
    const claimedId = searchParams.get("openid.claimed_id") ?? ""
    if (!claimedId.startsWith(STEAM_CLAIMED_ID_PREFIX)) {
      return NextResponse.redirect(getAppUrl("/?error=auth_failed", request))
    }

    const steamId = claimedId.slice(STEAM_CLAIMED_ID_PREFIX.length)
    if (!STEAM_ID_REGEX.test(steamId)) {
      return NextResponse.redirect(getAppUrl("/?error=auth_failed", request))
    }

    // --- Verify return_to matches our realm ---
    const returnTo = searchParams.get("openid.return_to") ?? ""
    const expectedRealm = process.env.NEXTAUTH_URL || new URL("/", request.url).origin
    if (!returnTo.startsWith(expectedRealm)) {
      return NextResponse.redirect(getAppUrl("/?error=auth_failed", request))
    }

    if (!isSteamIdWhitelisted(steamId)) {
      logger.info({ steamId }, "Auth rejected: Steam ID not whitelisted")
      return NextResponse.redirect(getAppUrl("/?error=not_whitelisted", request))
    }

    // --- Fetch user info from Steam API ---
    const steamApiKey = process.env.STEAM_API_KEY
    if (!steamApiKey) {
      throw new Error("Steam API key not configured")
    }

    const userInfoUrl = new URL("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/")
    userInfoUrl.searchParams.set("key", steamApiKey)
    userInfoUrl.searchParams.set("steamids", steamId)

    const levelUrl = new URL("https://api.steampowered.com/IPlayerService/GetSteamLevel/v1/")
    levelUrl.searchParams.set("key", steamApiKey)
    levelUrl.searchParams.set("steamid", steamId)

    const badgesUrl = new URL("https://api.steampowered.com/IPlayerService/GetBadges/v1/")
    badgesUrl.searchParams.set("key", steamApiKey)
    badgesUrl.searchParams.set("steamid", steamId)

    const [userInfoResponse, levelResponse, badgesResponse] = await Promise.all([
      fetch(userInfoUrl),
      fetch(levelUrl),
      fetch(badgesUrl),
    ])
    const userInfo = await userInfoResponse.json()
    const player = userInfo.response.players[0]

    if (!player) {
      return NextResponse.redirect(getAppUrl("/?error=auth_failed", request))
    }

    let steamLevel: number | null = null
    try {
      const levelData = await levelResponse.json()
      steamLevel = levelData.response?.player_level ?? null
    } catch {
      // Level fetch is non-critical
    }

    let badges: Array<{ badgeid: number; level: number }> | null = null
    try {
      const badgesData = await badgesResponse.json()
      const allBadges = badgesData.response?.badges as
        | Array<{ badgeid: number; level: number; appid?: number }>
        | undefined
      if (allBadges) {
        // Keep only community badges (no appid) that are visually interesting
        badges = allBadges.filter((b) => !b.appid).map((b) => ({ badgeid: b.badgeid, level: b.level }))
      }
    } catch {
      // Badges fetch is non-critical
    }

    cookieStore.set(
      "steam_user",
      JSON.stringify({
        steamId: player.steamid,
        displayName: player.personaname,
        avatar: player.avatarfull,
        profileUrl: player.profileurl,
        timecreated: player.timecreated || null,
        personaState: player.personastate ?? null,
        steamLevel,
        badges,
      }),
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 7, // 7 days
      },
    )

    logger.info({ steamId: player.steamid }, "Successful Steam login")

    return NextResponse.redirect(getAppUrl("/dashboard", request))
  } catch (error) {
    logger.error({ err: error, endpoint: "auth/steam/callback" }, "Steam auth error")
    return NextResponse.redirect(getAppUrl("/?error=auth_error", request))
  }
}
