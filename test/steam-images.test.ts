// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

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

const ORIGINAL_FETCH = globalThis.fetch
let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sbh-images-test-"))
  process.env.SQLITE_PATH = join(tmpDir, "test.sqlite")
  vi.resetModules()
})

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  delete process.env.SQLITE_PATH
  rmSync(tmpDir, { recursive: true, force: true })
})

async function seedGame(appId: number, overrides: Record<string, string | null> = {}) {
  const { getSqliteDatabase } = await import("@/lib/server/sqlite")
  const db = getSqliteDatabase()
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO games (
       appid, name, icon_hash, image_icon_url, image_landscape_url,
       image_portrait_url, images_synced_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    appId,
    "Test Game",
    overrides.icon_hash ?? "iconhash123",
    overrides.image_icon_url ?? null,
    overrides.image_landscape_url ?? null,
    overrides.image_portrait_url ?? null,
    overrides.images_synced_at ?? null,
    now,
    now,
  )
  return db
}

function readGame(appId: number) {
  return async () => {
    const { getSqliteDatabase } = await import("@/lib/server/sqlite")
    return getSqliteDatabase()
      .prepare("SELECT image_icon_url, image_landscape_url, image_portrait_url FROM games WHERE appid = ?")
      .get(appId) as {
      image_icon_url: string | null
      image_landscape_url: string | null
      image_portrait_url: string | null
    }
  }
}

describe("ensureGameImages", () => {
  it("is a no-op when all games already have images synced recently", async () => {
    const recentIso = new Date().toISOString()
    await seedGame(620, {
      image_icon_url: "http://cdn/icon.jpg",
      image_landscape_url: "http://cdn/landscape.jpg",
      image_portrait_url: "http://cdn/portrait.jpg",
      images_synced_at: recentIso,
    })

    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    const { ensureGameImages } = await import("@/lib/server/steam-images")
    await ensureGameImages([620])

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("persists HEAD-probed urls when the primary CDN returns 200", async () => {
    await seedGame(620)
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    })) as unknown as typeof fetch
    globalThis.fetch = fetchSpy

    const { ensureGameImages } = await import("@/lib/server/steam-images")
    await ensureGameImages([620])

    const row = await readGame(620)()
    expect(row.image_landscape_url).toContain("header.jpg")
    expect(row.image_portrait_url).toContain("library_600x900.jpg")
    expect(row.image_icon_url).toContain("iconhash123")
  })

  it("falls back to the Store API when HEAD probes fail for landscape/portrait", async () => {
    await seedGame(620, { icon_hash: null })

    let call = 0
    globalThis.fetch = vi.fn(async (url: unknown) => {
      call++
      const href = String(url)
      // HEAD probes: fail for landscape + portrait, succeed for icon capsule
      if (href.includes("store.steampowered.com/api/appdetails")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            "620": {
              success: true,
              data: { header_image: "https://store/header.jpg", capsule_image: "https://store/capsule.jpg" },
            },
          }),
        } as unknown as Response
      }
      if (href.includes("capsule_231x87")) {
        return { ok: true, status: 200, json: async () => ({}) } as unknown as Response
      }
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response
    }) as unknown as typeof fetch

    const { ensureGameImages } = await import("@/lib/server/steam-images")
    await ensureGameImages([620])

    const row = await readGame(620)()
    expect(row.image_landscape_url).toBe("https://store/header.jpg")
    expect(row.image_portrait_url).toBe("https://store/capsule.jpg")
    expect(row.image_icon_url).toContain("capsule_231x87")
    expect(call).toBeGreaterThan(0)
  })

  it("swallows store API failures and leaves unresolved fields null", async () => {
    await seedGame(620, { icon_hash: null })

    globalThis.fetch = vi.fn(async (url: unknown) => {
      const href = String(url)
      if (href.includes("store.steampowered.com/api/appdetails")) {
        return { ok: false, status: 500, json: async () => ({}) } as unknown as Response
      }
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response
    }) as unknown as typeof fetch

    const { ensureGameImages } = await import("@/lib/server/steam-images")
    await ensureGameImages([620])

    const row = await readGame(620)()
    expect(row.image_landscape_url).toBeNull()
    expect(row.image_portrait_url).toBeNull()
  })

  it("handles a rejecting Store API (network error) without throwing", async () => {
    await seedGame(620, { icon_hash: null })

    globalThis.fetch = vi.fn(async (url: unknown) => {
      const href = String(url)
      if (href.includes("store.steampowered.com/api/appdetails")) {
        throw new Error("network down")
      }
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response
    }) as unknown as typeof fetch

    const { ensureGameImages } = await import("@/lib/server/steam-images")
    await expect(ensureGameImages([620])).resolves.toBeUndefined()
  })

  it("ignores Store API responses where success=false", async () => {
    await seedGame(620, { icon_hash: null })

    globalThis.fetch = vi.fn(async (url: unknown) => {
      const href = String(url)
      if (href.includes("store.steampowered.com/api/appdetails")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ "620": { success: false } }),
        } as unknown as Response
      }
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response
    }) as unknown as typeof fetch

    const { ensureGameImages } = await import("@/lib/server/steam-images")
    await ensureGameImages([620])
    const row = await readGame(620)()
    expect(row.image_landscape_url).toBeNull()
  })

  it("is a no-op on empty appid list", async () => {
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    const { ensureGameImages } = await import("@/lib/server/steam-images")
    await ensureGameImages([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("re-probes images that are past the staleness window (30 days)", async () => {
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()
    await seedGame(620, {
      image_icon_url: "http://cdn/old-icon.jpg",
      image_landscape_url: "http://cdn/old-landscape.jpg",
      image_portrait_url: "http://cdn/old-portrait.jpg",
      images_synced_at: thirtyOneDaysAgo,
    })
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })) as unknown as typeof fetch
    globalThis.fetch = fetchSpy
    const { ensureGameImages } = await import("@/lib/server/steam-images")
    await ensureGameImages([620])
    expect(fetchSpy).toHaveBeenCalled()
  })
})
