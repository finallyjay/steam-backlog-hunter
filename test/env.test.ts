// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

describe("env validation", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("passes validation with valid env vars", async () => {
    vi.stubEnv("STEAM_API_KEY", "valid-key-123")
    vi.stubEnv("NODE_ENV", "test")

    const mod = await import("@/lib/env")
    expect(mod.env.STEAM_API_KEY).toBe("valid-key-123")
    expect(mod.env.NODE_ENV).toBe("test")
  })

  it("throws when STEAM_API_KEY is missing", async () => {
    vi.stubEnv("STEAM_API_KEY", "")

    const mod = await import("@/lib/env")
    expect(() => mod.env.STEAM_API_KEY).toThrow("Invalid environment variables")
  })

  it("accepts optional fields when not provided", async () => {
    vi.stubEnv("STEAM_API_KEY", "valid-key-123")
    vi.stubEnv("NODE_ENV", "test")

    const mod = await import("@/lib/env")
    expect(mod.env.STEAM_WHITELIST_IDS).toBeUndefined()
    expect(mod.env.NEXTAUTH_URL).toBeUndefined()
    expect(mod.env.SQLITE_PATH).toBeUndefined()
  })
})
