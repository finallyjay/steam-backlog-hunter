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

vi.mock("@/app/lib/server-auth", () => ({
  getCurrentUser: vi.fn(),
}))

vi.mock("@/lib/server/admin", () => ({
  isAdmin: vi.fn(),
}))

import { requireAdmin } from "@/app/lib/require-admin"
import { getCurrentUser } from "@/app/lib/server-auth"
import { isAdmin } from "@/lib/server/admin"

const mockUser = {
  steamId: "76561198000000001",
  displayName: "admin",
  avatar: "",
  profileUrl: "",
}

beforeEach(() => {
  vi.mocked(getCurrentUser).mockReset()
  vi.mocked(isAdmin).mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("requireAdmin", () => {
  it("returns null when unauthenticated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)
    expect(await requireAdmin()).toBeNull()
  })

  it("returns null when the user is not admin", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(isAdmin).mockReturnValue(false)
    expect(await requireAdmin()).toBeNull()
  })

  it("returns the user when they are admin", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(isAdmin).mockReturnValue(true)
    const result = await requireAdmin()
    expect(result?.steamId).toBe("76561198000000001")
  })
})
