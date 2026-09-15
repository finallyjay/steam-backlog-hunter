// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { AchievementChangeView } from "@/lib/types/steam"

const ORIGINAL_FETCH = globalThis.fetch

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response
}

function err(status: number) {
  return { ok: false, status, json: async () => ({}) } as unknown as Response
}

function change(overrides: Partial<AchievementChangeView>): AchievementChangeView {
  return {
    id: 1,
    appId: 620,
    gameName: "Portal 2",
    added: ["ACH_NEW"],
    removed: [],
    totalBefore: 2,
    totalAfter: 3,
    wasPerfect: true,
    detectedAt: "2026-09-05T00:00:00.000Z",
    seenAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  // Unmount every hook so its window listener is removed; otherwise stale
  // module instances from earlier tests keep reacting to the invalidate event.
  cleanup()
  globalThis.fetch = ORIGINAL_FETCH
  vi.clearAllMocks()
})

describe("useAchievementChanges", () => {
  it("loads changes on mount and exposes unseen rows plus a per-game rollup", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      ok({ changes: [change({ id: 1 }), change({ id: 2, seenAt: "2026-09-06T00:00:00.000Z" })] }),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const { useAchievementChanges } = await import("@/hooks/use-achievement-changes")

    const { result } = renderHook(() => useAchievementChanges())
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.changes).toHaveLength(2)
    expect(result.current.unseen.map((c) => c.id)).toEqual([1])
    expect(result.current.byAppId.get(620)?.added).toBe(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/steam/achievements/changes")
  })

  it("shares one fetch across consumers", async () => {
    const fetchMock = vi.fn(async () => ok({ changes: [] }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const { useAchievementChanges } = await import("@/hooks/use-achievement-changes")

    const a = renderHook(() => useAchievementChanges())
    const b = renderHook(() => useAchievementChanges())
    await waitFor(() => expect(a.result.current.loading).toBe(false))
    await waitFor(() => expect(b.result.current.loading).toBe(false))

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("sets error on a failed response and stops loading", async () => {
    globalThis.fetch = vi.fn(async () => err(500)) as unknown as typeof fetch
    const { useAchievementChanges } = await import("@/hooks/use-achievement-changes")

    const { result } = renderHook(() => useAchievementChanges())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe("Failed to fetch achievement changes")
    expect(result.current.changes).toEqual([])
  })

  it("marks seen optimistically and keeps it when the server accepts", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      if (init?.method === "PATCH") return ok({ updated: 1 })
      return ok({ changes: [change({ id: 1 }), change({ id: 2, appId: 730, gameName: "CS2" })] })
    }) as unknown as typeof fetch
    const { useAchievementChanges } = await import("@/hooks/use-achievement-changes")

    const { result } = renderHook(() => useAchievementChanges())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.unseen).toHaveLength(2)

    let accepted = false
    await act(async () => {
      accepted = await result.current.markSeen([1])
    })
    expect(accepted).toBe(true)
    expect(result.current.unseen.map((c) => c.id)).toEqual([2])
    expect(result.current.byAppId.has(620)).toBe(false)

    const patch = calls.find((c) => c.init?.method === "PATCH")
    expect(patch?.init?.body).toBe(JSON.stringify({ ids: [1] }))
  })

  it("marks everything seen with an empty body when no ids are given", async () => {
    const calls: Array<{ init?: RequestInit }> = []
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ init })
      if (init?.method === "PATCH") return ok({ updated: 2 })
      return ok({ changes: [change({ id: 1 }), change({ id: 2 })] })
    }) as unknown as typeof fetch
    const { useAchievementChanges } = await import("@/hooks/use-achievement-changes")

    const { result } = renderHook(() => useAchievementChanges())
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.markSeen()
    })
    expect(result.current.unseen).toHaveLength(0)
    expect(calls.find((c) => c.init?.method === "PATCH")?.init?.body).toBe("{}")
  })

  it("rolls back the optimistic update when the server rejects", async () => {
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") return err(500)
      return ok({ changes: [change({ id: 1 })] })
    }) as unknown as typeof fetch
    const { useAchievementChanges } = await import("@/hooks/use-achievement-changes")

    const { result } = renderHook(() => useAchievementChanges())
    await waitFor(() => expect(result.current.loading).toBe(false))

    let accepted = true
    await act(async () => {
      accepted = await result.current.markSeen([1])
    })
    expect(accepted).toBe(false)
    expect(result.current.unseen).toHaveLength(1)
  })

  it("refetches when steam data is invalidated", async () => {
    const fetchMock = vi.fn(async () => ok({ changes: [] }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const { useAchievementChanges } = await import("@/hooks/use-achievement-changes")

    const { result } = renderHook(() => useAchievementChanges())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      window.dispatchEvent(new CustomEvent("steam-data-invalidated"))
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })
})
