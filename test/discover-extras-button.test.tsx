// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { toastSpy } = vi.hoisted(() => ({ toastSpy: vi.fn() }))

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
  toast: toastSpy,
}))

import { DiscoverExtrasButton } from "@/components/extras/discover-extras-button"

const ORIGINAL_FETCH = globalThis.fetch

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response
}

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init),
  ) as unknown as typeof fetch
}

beforeEach(() => {
  toastSpy.mockClear()
})

afterEach(() => {
  cleanup()
  globalThis.fetch = ORIGINAL_FETCH
  vi.useRealTimers()
})

describe("DiscoverExtrasButton", () => {
  it("shows the last discovery timestamp from the status endpoint", async () => {
    mockFetch(async () => ok({ running: false, lastDiscoveryAt: "2026-09-18T10:00:00.000Z" }))
    render(<DiscoverExtrasButton />)
    await waitFor(() => expect(screen.getByText(/Last discovery/)).toBeTruthy())
    expect(screen.getByRole("button", { name: "Discover extras" })).not.toHaveProperty("disabled", true)
  })

  it("posts, toasts the summary and notifies the parent on success", async () => {
    const onDiscovered = vi.fn()
    mockFetch(async (_url, init) =>
      init?.method === "POST"
        ? ok({ discoveredAt: "2026-09-18T11:00:00.000Z", added: 3, updated: 5, total: 8 })
        : ok({ running: false, lastDiscoveryAt: null }),
    )
    render(<DiscoverExtrasButton onDiscovered={onDiscovered} />)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Discover extras" }))
    })
    await waitFor(() => expect(onDiscovered).toHaveBeenCalledTimes(1))
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Extras discovery completed",
        description: "3 new, 5 refreshed, 8 extras in total.",
      }),
    )
    expect(screen.getByText(/Last discovery/)).toBeTruthy()
  })

  it("surfaces the API error in a destructive toast", async () => {
    mockFetch(async (_url, init) =>
      init?.method === "POST"
        ? ({ ok: false, status: 429, json: async () => ({ error: "Too many requests" }) } as unknown as Response)
        : ok({ running: false, lastDiscoveryAt: null }),
    )
    render(<DiscoverExtrasButton />)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Discover extras" }))
    })
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Extras discovery failed",
          description: "Too many requests",
          variant: "destructive",
        }),
      ),
    )
    expect(screen.getByRole("button", { name: "Discover extras" })).toHaveProperty("disabled", false)
  })

  it("keeps the button disabled while a run started elsewhere is in progress", async () => {
    mockFetch(async () => ok({ running: true, lastDiscoveryAt: null }))
    render(<DiscoverExtrasButton />)
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Discover extras" })).toHaveProperty("disabled", true),
    )
    expect(screen.getByText("Discovering...")).toBeTruthy()
  })
})
