// @vitest-environment node
import { NextRequest } from "next/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { GET } from "@/app/api/auth/steam/callback/route"

describe("GET /api/auth/steam/callback", () => {
  const originalEnv = {
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    STEAM_WHITELIST_IDS: process.env.STEAM_WHITELIST_IDS,
  }

  afterEach(() => {
    process.env.NEXTAUTH_URL = originalEnv.NEXTAUTH_URL
    process.env.STEAM_WHITELIST_IDS = originalEnv.STEAM_WHITELIST_IDS
    vi.restoreAllMocks()
  })

  it("redirects non-whitelisted user to not_whitelisted error", async () => {
    process.env.NEXTAUTH_URL = "https://example.com"
    process.env.STEAM_WHITELIST_IDS = "76561198000000001"

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      text: async () => "is_valid:true",
    }))

    const request = new NextRequest(
      "https://example.com/api/auth/steam/callback?openid.claimed_id=https://steamcommunity.com/openid/id/76561198000000099",
    )

    const response = await GET(request)

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe("https://example.com/?error=not_whitelisted")
  })
})
