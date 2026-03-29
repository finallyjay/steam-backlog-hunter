import { describe, expect, it } from "vitest"

import { formatPlaytime } from "@/lib/utils"

describe("formatPlaytime", () => {
  it("returns '0m' for 0 hours", () => {
    expect(formatPlaytime(0)).toBe("0m")
  })

  it("returns '30m' for 0.5 hours", () => {
    expect(formatPlaytime(0.5)).toBe("30m")
  })

  it("returns '45m' for 0.75 hours", () => {
    expect(formatPlaytime(0.75)).toBe("45m")
  })

  it("returns '1h' for exactly 1 hour", () => {
    expect(formatPlaytime(1)).toBe("1h")
  })

  it("returns '1h 30m' for 1.5 hours", () => {
    expect(formatPlaytime(1.5)).toBe("1h 30m")
  })

  it("returns '14h 30m' for 14.5 hours", () => {
    expect(formatPlaytime(14.5)).toBe("14h 30m")
  })

  it("returns '100h' for 100 hours", () => {
    expect(formatPlaytime(100)).toBe("100h")
  })
})
