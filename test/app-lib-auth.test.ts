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

vi.mock("@/lib/whitelist", () => ({
  isSteamIdWhitelisted: vi.fn(),
}))

import { getCurrentUser, requireAuth } from "@/app/lib/server-auth"
import { isSteamIdWhitelisted } from "@/lib/whitelist"

const mockUser = {
  steamId: "76561198023709299",
  displayName: "Tester",
  avatar: "https://example.com/a.jpg",
  profileUrl: "https://steamcommunity.com/id/tester",
}

beforeEach(() => {
  cookieStore.get.mockReset()
  cookieStore.delete.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("getCurrentUser", () => {
  it("returns null when no cookie is present", async () => {
    cookieStore.get.mockReturnValue(undefined)
    const user = await getCurrentUser()
    expect(user).toBeNull()
  })

  it("returns null and does not throw when the cookie has no value", async () => {
    cookieStore.get.mockReturnValue({ name: "steam_user", value: "" })
    const user = await getCurrentUser()
    expect(user).toBeNull()
  })

  it("returns the user when the cookie JSON is valid and id is whitelisted", async () => {
    cookieStore.get.mockReturnValue({ name: "steam_user", value: JSON.stringify(mockUser) })
    vi.mocked(isSteamIdWhitelisted).mockReturnValue(true)
    const user = await getCurrentUser()
    expect(user?.steamId).toBe("76561198023709299")
  })

  it("clears the cookie and returns null when the id is NOT whitelisted", async () => {
    cookieStore.get.mockReturnValue({ name: "steam_user", value: JSON.stringify(mockUser) })
    vi.mocked(isSteamIdWhitelisted).mockReturnValue(false)
    const user = await getCurrentUser()
    expect(user).toBeNull()
    expect(cookieStore.delete).toHaveBeenCalledWith("steam_user")
  })

  it("returns null when the cookie JSON is malformed (swallows the parse error)", async () => {
    cookieStore.get.mockReturnValue({ name: "steam_user", value: "{not json" })
    const user = await getCurrentUser()
    expect(user).toBeNull()
  })
})

describe("requireAuth", () => {
  it("returns the user when authenticated", async () => {
    cookieStore.get.mockReturnValue({ name: "steam_user", value: JSON.stringify(mockUser) })
    vi.mocked(isSteamIdWhitelisted).mockReturnValue(true)
    const user = await requireAuth()
    expect(user.steamId).toBe("76561198023709299")
  })

  it("throws 'Authentication required' when there is no session", async () => {
    cookieStore.get.mockReturnValue(undefined)
    await expect(requireAuth()).rejects.toThrow("Authentication required")
  })
})
