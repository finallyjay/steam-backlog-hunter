// @vitest-environment node
import { describe, expect, it } from "vitest"

import { isPlaceholderName } from "@/lib/server/placeholder-names"

describe("isPlaceholderName", () => {
  it("matches each prefix exactly (no trailing digits)", () => {
    expect(isPlaceholderName("ValveTestApp")).toBe(true)
    expect(isPlaceholderName("UntitledApp")).toBe(true)
    expect(isPlaceholderName("GreenlightApp")).toBe(true)
    expect(isPlaceholderName("InvitedPartnerApp")).toBe(true)
  })

  it("matches each prefix followed by any run of digits", () => {
    expect(isPlaceholderName("ValveTestApp43110")).toBe(true)
    expect(isPlaceholderName("ValveTestApp0")).toBe(true)
    expect(isPlaceholderName("UntitledApp0")).toBe(true)
    expect(isPlaceholderName("UntitledApp42")).toBe(true)
    expect(isPlaceholderName("GreenlightApp0")).toBe(true)
    expect(isPlaceholderName("GreenlightApp1234")).toBe(true)
    expect(isPlaceholderName("InvitedPartnerApp102")).toBe(true)
  })

  it("does not match real game names", () => {
    expect(isPlaceholderName("Portal 2")).toBe(false)
    expect(isPlaceholderName("Counter-Strike 2")).toBe(false)
    expect(isPlaceholderName("Metro 2033")).toBe(false)
    expect(isPlaceholderName("Half-Life: Alyx")).toBe(false)
  })

  it("does not match variants with trailing non-digit text (case-sensitive)", () => {
    expect(isPlaceholderName("ValveTestApp43110 (Beta)")).toBe(false)
    expect(isPlaceholderName("valvetestapp43110")).toBe(false) // lowercase — different binary
    expect(isPlaceholderName("ValveTestAppA")).toBe(false) // letter suffix
    expect(isPlaceholderName("GreenlightApplication")).toBe(false) // real word happens to share prefix
  })

  it("returns false for empty, null or undefined", () => {
    expect(isPlaceholderName("")).toBe(false)
    expect(isPlaceholderName(null)).toBe(false)
    expect(isPlaceholderName(undefined)).toBe(false)
  })
})
