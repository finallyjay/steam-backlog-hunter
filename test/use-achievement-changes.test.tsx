// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { AchievementChangeView } from "@/lib/types/steam"

const { currentUserMock } = vi.hoisted(() => ({
  currentUserMock: { user: { steamId: "76561198023709299" } as { steamId: string } | null, loading: false },
}))

vi.mock("@/hooks/use-current-user", () => ({
  useCurrentUser: () => currentUserMock,
}))

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
  currentUserMock.user = { steamId: "76561198023709299" }
  currentUserMock.loading = false
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

  it("sets error on a failed response, stops loading, and retries on the next mount", async () => {
    let calls = 0
    globalThis.fetch = vi.fn(async () => {
      calls++
      return calls === 1 ? err(500) : ok({ changes: [change({ id: 1 })] })
    }) as unknown as typeof fetch
    const { useAchievementChanges } = await import("@/hooks/use-achievement-changes")

    const first = renderHook(() => useAchievementChanges())
    await waitFor(() => expect(first.result.current.loading).toBe(false))
    expect(first.result.current.error).toBe("Failed to fetch achievement changes")
    expect(first.result.current.changes).toEqual([])
    first.unmount()

    // A later consumer (navigation, reload) must not be stuck with the error.
    const second = renderHook(() => useAchievementChanges())
    await waitFor(() => expect(second.result.current.changes).toHaveLength(1))
    expect(second.result.current.error).toBeNull()
    expect(calls).toBe(2)
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

  it("reverts only the rows this call flipped when the server rejects", async () => {
    // Server-side truth: ids acknowledged by a successful PATCH stay seen on
    // the next GET, so the reconciling reload after a failure keeps them.
    const serverSeen = new Set<number>()
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        const { ids } = JSON.parse(String(init.body)) as { ids: number[] }
        if (ids[0] === 1) return err(500)
        for (const id of ids) serverSeen.add(id)
        return ok({ updated: ids.length })
      }
      return ok({
        changes: [change({ id: 1 }), change({ id: 2, appId: 730 })].map((c) =>
          serverSeen.has(c.id) ? { ...c, seenAt: "2026-09-15T00:00:00.000Z" } : c,
        ),
      })
    }) as unknown as typeof fetch
    const { useAchievementChanges } = await import("@/hooks/use-achievement-changes")

    const { result } = renderHook(() => useAchievementChanges())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await Promise.all([result.current.markSeen([1]), result.current.markSeen([2])])
    })
    // Row 1's failure must not undo row 2's successful acknowledgement,
    // neither in the optimistic rollback nor after the reconciling reload.
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.changes.find((c) => c.id === 1)?.seenAt).toBeNull()
    expect(result.current.changes.find((c) => c.id === 2)?.seenAt).not.toBeNull()
  })

  it("resets and refetches when the authenticated user changes, and clears on sign-out", async () => {
    const fetchMock = vi.fn(async () => ok({ changes: [change({ id: 1 })] }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const { useAchievementChanges } = await import("@/hooks/use-achievement-changes")

    const { result, rerender } = renderHook(() => useAchievementChanges())
    await waitFor(() => expect(result.current.changes).toHaveLength(1))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    currentUserMock.user = { steamId: "76561198000000009" }
    rerender()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.loading).toBe(false))

    currentUserMock.user = null
    rerender()
    await waitFor(() => expect(result.current.changes).toHaveLength(0))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("queues a forced reload requested while the initial fetch is in flight", async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let calls = 0
    globalThis.fetch = vi.fn(async () => {
      calls++
      if (calls === 1) {
        await gate
        return ok({ changes: [] })
      }
      return ok({ changes: [change({ id: 1 })] })
    }) as unknown as typeof fetch
    const { useAchievementChanges } = await import("@/hooks/use-achievement-changes")

    const { result } = renderHook(() => useAchievementChanges())
    // Sync finishes while the first request is still pending.
    await act(async () => {
      window.dispatchEvent(new CustomEvent("steam-data-invalidated"))
      window.dispatchEvent(new CustomEvent("steam-data-invalidated"))
    })
    release()
    await waitFor(() => expect(result.current.changes).toHaveLength(1))
    // Exactly one queued reload, not one per event.
    expect(calls).toBe(2)
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
