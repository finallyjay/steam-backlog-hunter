import { type NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"

const STEAM_OPENID_URL = "https://steamcommunity.com/openid/login"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams

  // Verify the OpenID response
  const params = new URLSearchParams()

  // Copy all parameters from the callback
  for (const [key, value] of searchParams.entries()) {
    params.append(key, value)
  }

  // Change mode to check_authentication for verification
  params.set("openid.mode", "check_authentication")

  try {
    // Verify with Steam
    const verifyResponse = await fetch(STEAM_OPENID_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    })

    const verifyText = await verifyResponse.text()

    if (verifyText.includes("is_valid:true")) {
      // Extract Steam ID from the claimed_id
      const claimedId = searchParams.get("openid.claimed_id")
      const steamId = claimedId?.split("/").pop()

      if (steamId) {
        // Fetch user info from Steam API
        const steamApiKey = process.env.STEAM_API_KEY
        if (!steamApiKey) {
          throw new Error("Steam API key not configured")
        }

        const userInfoResponse = await fetch(
          `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${steamApiKey}&steamids=${steamId}`,
        )

        const userInfo = await userInfoResponse.json()
        const player = userInfo.response.players[0]

        if (player) {
          // Store user session (in a real app, you'd use a proper session store)
          const cookieStore = await cookies()
          cookieStore.set(
            "steam_user",
            JSON.stringify({
              steamId: player.steamid,
              displayName: player.personaname,
              avatar: player.avatarfull,
              profileUrl: player.profileurl,
              timecreated: player.timecreated || null,
              personaState: player.personastate ?? null,
            }),
            {
              httpOnly: true,
              secure: process.env.NODE_ENV === "production",
              maxAge: 60 * 60 * 24 * 7, // 7 days
            },
          )

          // Redirect to the dashboard; prefer the domain from NEXTAUTH_URL when available
          const dashboardUrl = process.env.NEXTAUTH_URL
            ? `${process.env.NEXTAUTH_URL.replace(/\/$/, "")}/dashboard`
            : new URL("/dashboard", request.url).toString();
          return NextResponse.redirect(dashboardUrl)
        }
      }
    }

    // If verification failed, redirect to home with error
    return NextResponse.redirect(new URL("/?error=auth_failed", request.url))
  } catch (error) {
    console.error("Steam auth error:", error)
    return NextResponse.redirect(new URL("/?error=auth_error", request.url))
  }
}
