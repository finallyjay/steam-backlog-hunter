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
    process.env.STEAM_WHITELIST_IDS = "76561198023709299"

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

  it("redirects to auth_failed when nonce does not match cookie", async () => {
    process.env.NEXTAUTH_URL = "https://example.com"
    process.env.STEAM_WHITELIST_IDS = "76561198023709299"

    // Cookie has a different nonce than the query param
    const wrongNonce = "b".repeat(64)
    mockCookieStore.get.mockReturnValue({ value: wrongNonce })

    const request = new NextRequest(
      `https://example.com/api/auth/steam/callback?nonce=${TEST_NONCE}&openid.claimed_id=https://steamcommunity.com/openid/id/76561198023709299&openid.return_to=https://example.com/api/auth/steam/callback?nonce=${TEST_NONCE}`,
    )

    const response = await GET(request)

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe("https://example.com/?error=auth_failed")
  })

  it("redirects to auth_failed when Steam ID format is invalid", async () => {
    process.env.NEXTAUTH_URL = "https://example.com"
    process.env.STEAM_WHITELIST_IDS = "76561198023709299"

    mockCookieStore.get.mockReturnValue({ value: TEST_NONCE })

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        text: async () => "is_valid:true",
      }),
    )

    // Steam ID is too short (not 17 digits)
    const request = new NextRequest(
      `https://example.com/api/auth/steam/callback?nonce=${TEST_NONCE}&openid.claimed_id=https://steamcommunity.com/openid/id/12345&openid.return_to=https://example.com/api/auth/steam/callback?nonce=${TEST_NONCE}`,
    )

    const response = await GET(request)

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe("https://example.com/?error=auth_failed")
  })

  it("redirects to auth_failed when Steam verification rejects", async () => {
    process.env.NEXTAUTH_URL = "https://example.com"
    process.env.STEAM_WHITELIST_IDS = "76561198023709299"

    mockCookieStore.get.mockReturnValue({ value: TEST_NONCE })

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        text: async () => "is_valid:false",
      }),
    )

    const request = new NextRequest(
      `https://example.com/api/auth/steam/callback?nonce=${TEST_NONCE}&openid.claimed_id=https://steamcommunity.com/openid/id/76561198023709299&openid.return_to=https://example.com/api/auth/steam/callback?nonce=${TEST_NONCE}`,
    )

    const response = await GET(request)

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe("https://example.com/?error=auth_failed")
  })

  it("redirects to auth_failed when claimed_id prefix is wrong", async () => {
    process.env.NEXTAUTH_URL = "https://example.com"

    mockCookieStore.get.mockReturnValue({ value: TEST_NONCE })

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        text: async () => "is_valid:true",
      }),
    )

    const request = new NextRequest(
      `https://example.com/api/auth/steam/callback?nonce=${TEST_NONCE}&openid.claimed_id=https://evil.com/openid/id/76561198023709299&openid.return_to=https://example.com/api/auth/steam/callback?nonce=${TEST_NONCE}`,
    )

    const response = await GET(request)

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe("https://example.com/?error=auth_failed")
  })

  it("redirects to auth_failed when return_to does not match realm", async () => {
    process.env.NEXTAUTH_URL = "https://example.com"
    process.env.STEAM_WHITELIST_IDS = "76561198023709299"

    mockCookieStore.get.mockReturnValue({ value: TEST_NONCE })

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        text: async () => "is_valid:true",
      }),
    )

    const request = new NextRequest(
      `https://example.com/api/auth/steam/callback?nonce=${TEST_NONCE}&openid.claimed_id=https://steamcommunity.com/openid/id/76561198023709299&openid.return_to=https://evil.com/callback`,
    )

    const response = await GET(request)

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe("https://example.com/?error=auth_failed")
  })

  it("redirects whitelisted user to dashboard with session cookie", async () => {
    const steamId = "76561198023709299"
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

  it("includes steam level and badges in session cookie", async () => {
    const steamId = "76561198023709299"
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
        if (urlStr.includes("GetSteamLevel")) {
          return Promise.resolve({
            json: async () => ({ response: { player_level: 42 } }),
          })
        }
        if (urlStr.includes("GetBadges")) {
          return Promise.resolve({
            json: async () => ({
              response: {
                badges: [
                  { badgeid: 13, level: 50 },
                  { badgeid: 2, level: 3, appid: 440 },
                ],
              },
            }),
          })
        }
        return Promise.resolve({ text: async () => "is_valid:true" })
      }),
    )

    const request = new NextRequest(
      `https://example.com/api/auth/steam/callback?nonce=${TEST_NONCE}&openid.claimed_id=https://steamcommunity.com/openid/id/${steamId}&openid.return_to=https://example.com/api/auth/steam/callback?nonce=${TEST_NONCE}`,
    )

    const response = await GET(request)

    expect(response.status).toBe(307)

    const cookiePayload = mockCookieStore.set.mock.calls[0][1] as string
    const parsed = JSON.parse(cookiePayload)
    expect(parsed.steamLevel).toBe(42)
    // Only community badges (no appid) should be stored
    expect(parsed.badges).toEqual([{ badgeid: 13, level: 50 }])
  })

  it("handles auth error gracefully", async () => {
    process.env.NEXTAUTH_URL = "https://example.com"
    process.env.STEAM_WHITELIST_IDS = "76561198023709299"
    process.env.STEAM_API_KEY = "test-api-key"

    mockCookieStore.get.mockReturnValue({ value: TEST_NONCE })

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string | URL) => {
        const urlStr = url instanceof URL ? url.toString() : url
        if (urlStr.includes("GetPlayerSummaries")) {
          return Promise.reject(new Error("Network error"))
        }
        return Promise.resolve({ text: async () => "is_valid:true" })
      }),
    )

    const request = new NextRequest(
      `https://example.com/api/auth/steam/callback?nonce=${TEST_NONCE}&openid.claimed_id=https://steamcommunity.com/openid/id/76561198023709299&openid.return_to=https://example.com/api/auth/steam/callback?nonce=${TEST_NONCE}`,
    )

    const response = await GET(request)

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe("https://example.com/?error=auth_error")
  })
})
