// @vitest-environment node
import { describe, expect, it } from "vitest"

import { isPlaceholderName } from "@/lib/server/placeholder-names"

describe("isPlaceholderName", () => {
  it("matches ValveTestApp followed by digits", () => {
    expect(isPlaceholderName("ValveTestApp43110")).toBe(true)
    expect(isPlaceholderName("ValveTestApp1")).toBe(true)
    expect(isPlaceholderName("ValveTestApp203190")).toBe(true)
  })

  it("matches UntitledApp exactly", () => {
    expect(isPlaceholderName("UntitledApp")).toBe(true)
  })

  it("matches InvitedPartnerApp followed by digits", () => {
    expect(isPlaceholderName("InvitedPartnerApp102")).toBe(true)
    expect(isPlaceholderName("InvitedPartnerApp9")).toBe(true)
  })

  it("does not match real game names", () => {
    expect(isPlaceholderName("Portal 2")).toBe(false)
    expect(isPlaceholderName("Counter-Strike 2")).toBe(false)
    expect(isPlaceholderName("Metro 2033")).toBe(false)
    expect(isPlaceholderName("Half-Life: Alyx")).toBe(false)
  })

  it("does not match variants with trailing text (case-sensitive by design)", () => {
    expect(isPlaceholderName("ValveTestApp")).toBe(false) // no digits
    expect(isPlaceholderName("ValveTestApp43110 (Beta)")).toBe(false)
    expect(isPlaceholderName("valvetestapp43110")).toBe(false) // lowercase — different binary
    expect(isPlaceholderName("UntitledApp2")).toBe(false) // UntitledApp doesn't take a numeric suffix
    expect(isPlaceholderName("InvitedPartnerApp")).toBe(false)
  })

  it("returns false for empty, null or undefined", () => {
    expect(isPlaceholderName("")).toBe(false)
    expect(isPlaceholderName(null)).toBe(false)
    expect(isPlaceholderName(undefined)).toBe(false)
  })
})
