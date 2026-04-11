// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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

vi.mock("@/lib/server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const cookieStore = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
}
vi.mock("next/headers", () => ({
  cookies: async () => cookieStore,
}))

vi.mock("@/app/lib/server-auth", () => ({
  getCurrentUser: vi.fn(),
}))

// rate-limit is real — we control it via the same in-process map by reset
vi.mock("@/lib/server/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/rate-limit")>("@/lib/server/rate-limit")
  return actual
})

import { GET as authMeGet } from "@/app/api/auth/me/route"
import { POST as logoutPost } from "@/app/api/auth/logout/route"
import { GET as steamGet } from "@/app/api/auth/steam/route"
import { getCurrentUser } from "@/app/lib/server-auth"

const mockUser = {
  steamId: "76561198023709299",
  displayName: "Tester",
  avatar: "https://example.com/a.jpg",
  profileUrl: "https://steamcommunity.com/id/tester",
}

beforeEach(() => {
  cookieStore.get.mockReset()
  cookieStore.set.mockReset()
  cookieStore.delete.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/auth/me", () => {
  it("returns { user: null } when no session", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)
    const res = await authMeGet()
    const body = await res.json()
    expect(body).toEqual({ user: null })
  })

  it("returns the user object when authenticated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    const res = await authMeGet()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user?.steamId).toBe("76561198023709299")
  })
})

describe("POST /api/auth/logout", () => {
  it("deletes the steam_user cookie and returns success", async () => {
    const res = await logoutPost()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(cookieStore.delete).toHaveBeenCalledWith("steam_user")
  })
})

describe("GET /api/auth/steam", () => {
  function makeRequest(ip = "198.51.100.1") {
    return new Request("http://localhost/api/auth/steam", {
      headers: { "x-forwarded-for": ip },
    }) as unknown as Parameters<typeof steamGet>[0]
  }

  it("sets a nonce cookie and redirects to Steam's OpenID login", async () => {
    const res = await steamGet(makeRequest("198.51.100.10"))
    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(400)
    const location = res.headers.get("location")
    expect(location).toContain("steamcommunity.com/openid/login")
    expect(location).toContain("openid.mode=checkid_setup")
    expect(cookieStore.set).toHaveBeenCalledWith(
      "steam_openid_nonce",
      expect.any(String),
      expect.objectContaining({ httpOnly: true, sameSite: "lax" }),
    )
  })

  it("returns 429 when the rate limit is exhausted", async () => {
    // Hammer the endpoint 11 times from the same IP; the 11th should trip
    // the default 10-req-per-60s limit.
    const hammerIp = "198.51.100.200"
    for (let i = 0; i < 10; i++) await steamGet(makeRequest(hammerIp))
    const res = await steamGet(makeRequest(hammerIp))
    expect(res.status).toBe(429)
  })
})
