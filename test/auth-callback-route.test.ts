// @vitest-environment node
import { NextRequest } from "next/server"
import { afterEach, describe, expect, it, vi } from "vitest"

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

const TEST_NONCE = "a".repeat(64)

const { mockCookieStore } = vi.hoisted(() => {
  const mockCookieStore = {
    set: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
  }
  return { mockCookieStore }
})
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue(mockCookieStore),
}))

import { GET } from "@/app/api/auth/steam/callback/route"

describe("GET /api/auth/steam/callback", () => {
  const originalEnv = {
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    STEAM_WHITELIST_IDS: process.env.STEAM_WHITELIST_IDS,
    STEAM_API_KEY: process.env.STEAM_API_KEY,
  }

  afterEach(() => {
    process.env.NEXTAUTH_URL = originalEnv.NEXTAUTH_URL
    process.env.STEAM_WHITELIST_IDS = originalEnv.STEAM_WHITELIST_IDS
    process.env.STEAM_API_KEY = originalEnv.STEAM_API_KEY
    vi.restoreAllMocks()
    mockCookieStore.set.mockClear()
  })

  it("redirects non-whitelisted user to not_whitelisted error", async () => {
    process.env.NEXTAUTH_URL = "https://example.com"
    process.env.STEAM_WHITELIST_IDS = "76561198000000001"

    mockCookieStore.get.mockReturnValue({ value: TEST_NONCE })

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        text: async () => "is_valid:true",
      }),
    )

    const request = new NextRequest(
      `https://example.com/api/auth/steam/callback?nonce=${TEST_NONCE}&openid.claimed_id=https://steamcommunity.com/openid/id/76561198000000099&openid.return_to=https://example.com/api/auth/steam/callback?nonce=${TEST_NONCE}`,
    )

    const response = await GET(request)

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe("https://example.com/?error=not_whitelisted")
  })

  it("redirects whitelisted user to dashboard with session cookie", async () => {
    const steamId = "76561198000000001"
    process.env.NEXTAUTH_URL = "https://example.com"
    process.env.STEAM_WHITELIST_IDS = steamId
    process.env.STEAM_API_KEY = "test-api-key"

    mockCookieStore.get.mockReturnValue({ value: TEST_NONCE })

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string | URL) => {
        const urlStr = url instanceof URL ? url.toString() : url
        if (urlStr.includes("GetPlayerSummaries")) {
          return Promise.resolve({
            json: async () => ({
              response: {
                players: [
                  {
                    steamid: steamId,
                    personaname: "TestPlayer",
                    avatarfull: "https://avatar.url/full.jpg",
                    profileurl: "https://steamcommunity.com/id/testplayer/",
                    timecreated: 1234567890,
                    personastate: 1,
                  },
                ],
              },
            }),
          })
        }
        // OpenID verification
        return Promise.resolve({
          text: async () => "is_valid:true",
        })
      }),
    )

    const request = new NextRequest(
      `https://example.com/api/auth/steam/callback?nonce=${TEST_NONCE}&openid.claimed_id=https://steamcommunity.com/openid/id/${steamId}&openid.return_to=https://example.com/api/auth/steam/callback?nonce=${TEST_NONCE}`,
    )

    const response = await GET(request)

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe("https://example.com/dashboard")
    expect(mockCookieStore.set).toHaveBeenCalledWith(
      "steam_user",
      expect.stringContaining(steamId),
      expect.objectContaining({ httpOnly: true, path: "/" }),
    )
  })
})
