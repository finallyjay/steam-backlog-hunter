// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { useIsMobile } from "@/hooks/use-mobile"

function setWindowWidth(px: number) {
  Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: px })
}

const originalMatchMedia = window.matchMedia
type MqlListener = (e: MediaQueryListEvent) => void
let triggerChange: (() => void) | null = null

beforeEach(() => {
  const listeners: MqlListener[] = []
  triggerChange = () => {
    listeners.forEach((l) => l({} as MediaQueryListEvent))
  }
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: window.innerWidth < 768,
    media: query,
    onchange: null,
    addEventListener: (_event: string, handler: MqlListener) => listeners.push(handler),
    removeEventListener: (_event: string, handler: MqlListener) => {
      const idx = listeners.indexOf(handler)
      if (idx >= 0) listeners.splice(idx, 1)
    },
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as typeof window.matchMedia
})

afterEach(() => {
  window.matchMedia = originalMatchMedia
})

describe("useIsMobile", () => {
  it("returns true when window width is below 768px", () => {
    setWindowWidth(500)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(true)
  })

  it("returns false when window width is 768px or greater", () => {
    setWindowWidth(1024)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)
  })

  it("reacts to viewport changes via matchMedia", () => {
    setWindowWidth(1024)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)

    act(() => {
      setWindowWidth(400)
      triggerChange?.()
    })
    expect(result.current).toBe(true)
  })
})
