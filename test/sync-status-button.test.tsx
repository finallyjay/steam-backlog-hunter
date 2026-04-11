// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { toastSpy, invalidateSpy } = vi.hoisted(() => ({
  toastSpy: vi.fn(),
  invalidateSpy: vi.fn(),
}))

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
  toast: toastSpy,
}))

vi.mock("@/hooks/use-steam-data", () => ({
  invalidateSteamData: invalidateSpy,
}))

import { SyncStatusButton, useSyncStatus } from "@/components/dashboard/sync-status-button"

const ORIGINAL_FETCH = globalThis.fetch

function mockFetchSequence(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init),
  ) as unknown as typeof fetch
}

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response
}

function errResponse(status: number, body?: unknown) {
  return {
    ok: false,
    status,
    json: async () => body ?? { error: "Failed" },
  } as unknown as Response
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  toastSpy.mockClear()
  invalidateSpy.mockClear()
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  globalThis.fetch = ORIGINAL_FETCH
  consoleErrorSpy.mockRestore()
  vi.clearAllMocks()
})

describe("useSyncStatus", () => {
  it("surfaces stats sync timestamp as a human-readable label", async () => {
    mockFetchSequence(async () =>
      ok({
        lastOwnedGamesSyncAt: null,
        lastRecentGamesSyncAt: null,
        lastStatsSyncAt: "2026-04-11T10:00:00.000Z",
      }),
    )
    const { result } = renderHook(() => useSyncStatus())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.label).toContain("Last sync")
  })

  it("falls back to owned games timestamp when stats is missing", async () => {
    mockFetchSequence(async () =>
      ok({
        lastOwnedGamesSyncAt: "2026-04-11T10:00:00.000Z",
        lastRecentGamesSyncAt: null,
        lastStatsSyncAt: null,
      }),
    )
    const { result } = renderHook(() => useSyncStatus())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.label).toContain("Last sync")
  })

  it("returns null label when nothing has been synced", async () => {
    mockFetchSequence(async () =>
      ok({
        lastOwnedGamesSyncAt: null,
        lastRecentGamesSyncAt: null,
        lastStatsSyncAt: null,
      }),
    )
    const { result } = renderHook(() => useSyncStatus())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.label).toBeNull()
  })

  it("returns null label for an unparseable timestamp", async () => {
    mockFetchSequence(async () =>
      ok({
        lastOwnedGamesSyncAt: null,
        lastRecentGamesSyncAt: null,
        lastStatsSyncAt: "not a date",
      }),
    )
    const { result } = renderHook(() => useSyncStatus())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.label).toBeNull()
  })

  it("silently handles a failed status fetch", async () => {
    mockFetchSequence(async () => errResponse(500))
    const { result } = renderHook(() => useSyncStatus())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.label).toBeNull()
  })

  it("silently handles a rejected status fetch", async () => {
    mockFetchSequence(async () => {
      throw new Error("network")
    })
    const { result } = renderHook(() => useSyncStatus())
    await waitFor(() => expect(result.current.loading).toBe(false))
  })
})

describe("SyncStatusButton", () => {
  it("shows 'Sync' initially and calls POST /api/steam/sync on click", async () => {
    const urls: string[] = []
    mockFetchSequence(async (url, init) => {
      urls.push(`${init?.method ?? "GET"} ${url}`)
      if (init?.method === "POST") {
        return ok({
          syncedAt: "2026-04-11T10:00:00.000Z",
          ownedGames: 100,
          recentGames: 5,
          stats: { totalGames: 100, totalAchievements: 1500, totalPlaytime: 200, perfectGames: 3 },
        })
      }
      return ok({ lastOwnedGamesSyncAt: null, lastRecentGamesSyncAt: null, lastStatsSyncAt: null })
    })

    render(<SyncStatusButton />)
    expect(screen.getByRole("button")).toHaveTextContent(/Sync/)

    fireEvent.click(screen.getByRole("button"))

    await waitFor(() => expect(urls.some((u) => u.startsWith("POST") && u.includes("/api/steam/sync"))).toBe(true))
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled())
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Steam sync completed" })),
    )
  })

  it("shows an error toast when POST fails with a structured error body", async () => {
    mockFetchSequence(async (_url, init) => {
      if (init?.method === "POST") {
        return errResponse(500, { error: "Upstream down" })
      }
      return ok({ lastOwnedGamesSyncAt: null, lastRecentGamesSyncAt: null, lastStatsSyncAt: null })
    })

    render(<SyncStatusButton />)
    fireEvent.click(screen.getByRole("button"))

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Steam sync failed", variant: "destructive" }),
      ),
    )
    expect(invalidateSpy).not.toHaveBeenCalled()
  })

  it("shows an error toast when POST fails with unparseable body", async () => {
    mockFetchSequence(async (_url, init) => {
      if (init?.method === "POST") {
        return {
          ok: false,
          status: 500,
          json: async () => {
            throw new Error("not json")
          },
        } as unknown as Response
      }
      return ok({ lastOwnedGamesSyncAt: null, lastRecentGamesSyncAt: null, lastStatsSyncAt: null })
    })

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    render(<SyncStatusButton />)
    fireEvent.click(screen.getByRole("button"))
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Steam sync failed", variant: "destructive" }),
      ),
    )
    consoleSpy.mockRestore()
  })

  it("shows 'Syncing...' while the POST is in flight", async () => {
    let resolvePost: (() => void) | null = null
    mockFetchSequence(async (_url, init) => {
      if (init?.method === "POST") {
        await new Promise<void>((resolve) => {
          resolvePost = resolve
        })
        return ok({
          syncedAt: "2026-04-11T10:00:00.000Z",
          ownedGames: 0,
          recentGames: 0,
          stats: { totalGames: 0, totalAchievements: 0, totalPlaytime: 0, perfectGames: 0 },
        })
      }
      return ok({ lastOwnedGamesSyncAt: null, lastRecentGamesSyncAt: null, lastStatsSyncAt: null })
    })

    render(<SyncStatusButton />)
    fireEvent.click(screen.getByRole("button"))
    await waitFor(() => expect(screen.getByRole("button")).toBeDisabled())
    act(() => {
      resolvePost?.()
    })
    await waitFor(() => expect(screen.getByRole("button")).not.toBeDisabled())
  })
})
