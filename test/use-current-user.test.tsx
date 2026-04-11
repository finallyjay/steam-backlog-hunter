// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const toastSpy = vi.fn()
vi.mock("@/hooks/use-toast", () => ({ toast: toastSpy }))

const ORIGINAL_FETCH = globalThis.fetch

const MOCK_USER = {
  steamId: "76561198023709299",
  displayName: "Tester",
  avatar: "",
  profileUrl: "",
}

function mockFetch(handler: () => Promise<Response>) {
  globalThis.fetch = vi.fn().mockImplementation(handler) as unknown as typeof fetch
}

function okResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response
}

function errorResponse(status: number) {
  return {
    ok: false,
    status,
    json: async () => ({}),
  } as unknown as Response
}

beforeEach(() => {
  vi.resetModules()
  toastSpy.mockClear()
})

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  vi.clearAllMocks()
})

describe("useCurrentUser", () => {
  it("returns user on successful fetch", async () => {
    mockFetch(async () => okResponse({ user: MOCK_USER }))
    const { useCurrentUser } = await import("@/hooks/use-current-user")
    const { result } = renderHook(() => useCurrentUser())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.user?.steamId).toBe("76561198023709299")
  })

  it("shows an authentication-error toast on 5xx", async () => {
    mockFetch(async () => errorResponse(500))
    const { useCurrentUser } = await import("@/hooks/use-current-user")
    const { result } = renderHook(() => useCurrentUser())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Authentication error", variant: "destructive" }),
    )
    expect(result.current.user).toBeNull()
  })

  it("silently flips loading=false on 4xx (unauthenticated)", async () => {
    mockFetch(async () => errorResponse(401))
    const { useCurrentUser } = await import("@/hooks/use-current-user")
    const { result } = renderHook(() => useCurrentUser())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(toastSpy).not.toHaveBeenCalled()
    expect(result.current.user).toBeNull()
  })

  it("shows a network-error toast when fetch rejects", async () => {
    mockFetch(async () => {
      throw new Error("boom")
    })
    const { useCurrentUser } = await import("@/hooks/use-current-user")
    const { result } = renderHook(() => useCurrentUser())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Network error", variant: "destructive" }))
  })

  it("clearCurrentUser wipes the cached state", async () => {
    mockFetch(async () => okResponse({ user: MOCK_USER }))
    const { useCurrentUser, clearCurrentUser } = await import("@/hooks/use-current-user")
    const { result } = renderHook(() => useCurrentUser())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user).not.toBeNull()

    act(() => {
      clearCurrentUser()
    })
    expect(result.current.user).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it("revalidates on visibilitychange back to 'visible'", async () => {
    let calls = 0
    mockFetch(async () => {
      calls++
      return okResponse({ user: MOCK_USER })
    })
    const { useCurrentUser } = await import("@/hooks/use-current-user")
    const { result } = renderHook(() => useCurrentUser())
    await waitFor(() => expect(result.current.loading).toBe(false))
    const initialCalls = calls

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" })
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await waitFor(() => expect(calls).toBeGreaterThan(initialCalls))
  })

  it("ignores visibilitychange when the tab is hidden", async () => {
    let calls = 0
    mockFetch(async () => {
      calls++
      return okResponse({ user: MOCK_USER })
    })
    const { useCurrentUser } = await import("@/hooks/use-current-user")
    renderHook(() => useCurrentUser())
    await waitFor(() => expect(calls).toBe(1))

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" })
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    // Give microtasks a chance to flush
    await new Promise((r) => setTimeout(r, 10))
    expect(calls).toBe(1)
  })
})
