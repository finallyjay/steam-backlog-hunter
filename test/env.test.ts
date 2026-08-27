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

describe("env validation: SESSION_SECRET", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("falls back to STEAM_API_KEY outside production when unset, logging a warning", async () => {
    vi.stubEnv("STEAM_API_KEY", "test-api-key")
    vi.stubEnv("SESSION_SECRET", undefined)
    vi.stubEnv("NODE_ENV", "development")

    const { logger } = await import("@/lib/server/logger")
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined as never)

    const mod = await import("@/lib/env")
    expect(mod.env.SESSION_SECRET).toBeUndefined()
    expect(mod.env.STEAM_API_KEY).toBe("test-api-key")
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("SESSION_SECRET is not set"))

    warnSpy.mockRestore()
  })

  it("does not warn when SESSION_SECRET is set outside production", async () => {
    vi.stubEnv("STEAM_API_KEY", "test-api-key")
    vi.stubEnv("SESSION_SECRET", "dev-secret")
    vi.stubEnv("NODE_ENV", "development")

    const { logger } = await import("@/lib/server/logger")
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined as never)

    const mod = await import("@/lib/env")
    expect(mod.env.SESSION_SECRET).toBe("dev-secret")
    expect(warnSpy).not.toHaveBeenCalled()

    warnSpy.mockRestore()
  })

  it("fails fast when SESSION_SECRET is unset in production", async () => {
    vi.stubEnv("STEAM_API_KEY", "test-api-key")
    vi.stubEnv("SESSION_SECRET", undefined)
    vi.stubEnv("NODE_ENV", "production")

    const mod = await import("@/lib/env")
    expect(() => mod.env.SESSION_SECRET).toThrow("Invalid environment variables")
  })

  it("passes validation in production when SESSION_SECRET is set", async () => {
    vi.stubEnv("STEAM_API_KEY", "test-api-key")
    vi.stubEnv("SESSION_SECRET", "a-dedicated-prod-secret")
    vi.stubEnv("NODE_ENV", "production")

    const mod = await import("@/lib/env")
    expect(mod.env.SESSION_SECRET).toBe("a-dedicated-prod-secret")
  })
})
