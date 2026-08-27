import { describe, expect, it } from "vitest"

import { getClientIp } from "@/lib/server/client-ip"

function headersWith(entries: Record<string, string>): Headers {
  return new Headers(entries)
}

describe("getClientIp", () => {
  it("takes the last entry from a multi-hop x-forwarded-for list", () => {
    const headers = headersWith({
      "x-forwarded-for": "203.0.113.1, 198.51.100.2, 192.0.2.3",
    })
    // 192.0.2.3 is the address the trusted proxy appended; everything to
    // its left was supplied by untrusted, possibly-spoofed hops.
    expect(getClientIp(headers)).toBe("192.0.2.3")
  })

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const headers = headersWith({ "x-real-ip": "198.51.100.42" })
    expect(getClientIp(headers)).toBe("198.51.100.42")
  })

  it("falls back to 'unknown' when no IP headers are present", () => {
    const headers = headersWith({})
    expect(getClientIp(headers)).toBe("unknown")
  })

  it("is not fooled by spoofing earlier entries in the list", () => {
    const trustedTail = "192.0.2.3"
    const withoutSpoofing = headersWith({ "x-forwarded-for": trustedTail })
    const withSpoofing = headersWith({
      "x-forwarded-for": `1.1.1.1, 2.2.2.2, 3.3.3.3, ${trustedTail}`,
    })

    // Prepending fake addresses does not change the resolved key, since
    // only the rightmost (proxy-appended) entry is trusted.
    expect(getClientIp(withSpoofing)).toBe(getClientIp(withoutSpoofing))
    expect(getClientIp(withSpoofing)).toBe(trustedTail)
  })

  it("prefers x-forwarded-for over x-real-ip when both are present", () => {
    const headers = headersWith({
      "x-forwarded-for": "198.51.100.2, 192.0.2.9",
      "x-real-ip": "203.0.113.55",
    })
    expect(getClientIp(headers)).toBe("192.0.2.9")
  })

  it("strips a trailing port from an IPv4 address", () => {
    const headers = headersWith({ "x-forwarded-for": "192.0.2.9:54321" })
    expect(getClientIp(headers)).toBe("192.0.2.9")
  })

  it("handles bracketed IPv6 addresses with a port", () => {
    const headers = headersWith({ "x-forwarded-for": "[2001:db8::1]:54321" })
    expect(getClientIp(headers)).toBe("2001:db8::1")
  })

  it("handles bracketed IPv6 addresses without a port", () => {
    const headers = headersWith({ "x-forwarded-for": "[2001:db8::1]" })
    expect(getClientIp(headers)).toBe("2001:db8::1")
  })

  it("trims surrounding whitespace around entries", () => {
    const headers = headersWith({ "x-forwarded-for": "  1.1.1.1  ,  192.0.2.9  " })
    expect(getClientIp(headers)).toBe("192.0.2.9")
  })

  it("ignores a trailing empty entry after a stray comma", () => {
    const headers = headersWith({ "x-forwarded-for": "192.0.2.9, " })
    expect(getClientIp(headers)).toBe("192.0.2.9")
  })
})
