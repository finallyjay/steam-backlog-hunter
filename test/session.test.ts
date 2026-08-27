import { describe, it, expect, beforeAll, afterEach, vi } from "vitest"
import crypto from "node:crypto"
import { signSession, verifySession, SESSION_MAX_AGE_SECONDS } from "@/lib/server/session"
import type { SteamUser } from "@/lib/auth"

/** Signs an arbitrary payload the same way session.ts does, for tests that need to construct tokens signSession() itself won't produce (e.g. an expired or exp-less token). */
function signRaw(payload: unknown): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const sig = crypto.createHmac("sha256", "unit-test-session-secret").update(encoded).digest("base64url")
  return `${encoded}.${sig}`
}

const USER: SteamUser = {
  steamId: "76561198023709299",
  displayName: "Jay",
  avatar: "https://cdn/a.png",
  profileUrl: "https://steamcommunity.com/id/jay",
  timecreated: 1234567890,
  personaState: 1,
  communityVisibilityState: 3,
  steamLevel: 42,
  badges: [{ badgeid: 1, level: 5 }],
}

beforeAll(() => {
  // session.ts signs with SESSION_SECRET (or STEAM_API_KEY); env validation
  // also requires STEAM_API_KEY to be present.
  process.env.STEAM_API_KEY = "test-api-key"
  process.env.SESSION_SECRET = "unit-test-session-secret"
})

describe("session signing", () => {
  it("round-trips a signed session (including nested badges)", () => {
    const token = signSession(USER)
    expect(token).toContain(".")
    expect(verifySession(token)).toEqual(USER)
  })

  it("rejects a forged payload with no/invalid signature (the core fix)", () => {
    // What an attacker who knows a whitelisted Steam64 ID would try: a plain
    // JSON cookie like the old format.
    const forged = JSON.stringify({ steamId: "76561198023709299" })
    expect(verifySession(forged)).toBeNull()
    expect(verifySession(Buffer.from(forged).toString("base64url") + ".deadbeef")).toBeNull()
  })

  it("rejects a tampered payload (signature no longer matches)", () => {
    const token = signSession(USER)
    const [payload, sig] = token.split(".")
    const tampered = Buffer.from(JSON.stringify({ ...USER, steamId: "00000000000000000" })).toString("base64url")
    expect(verifySession(`${tampered}.${sig}`)).toBeNull()
    expect(verifySession(`${payload}.${sig}`)).toEqual(USER)
  })

  it("returns null for missing / malformed tokens", () => {
    expect(verifySession(undefined)).toBeNull()
    expect(verifySession(null)).toBeNull()
    expect(verifySession("")).toBeNull()
    expect(verifySession("nodothere")).toBeNull()
    expect(verifySession(".sigonly")).toBeNull()
  })

  it("returns null when a validly-signed payload isn't valid JSON", () => {
    const payload = Buffer.from("not json{").toString("base64url")
    const sig = crypto.createHmac("sha256", "unit-test-session-secret").update(payload).digest("base64url")
    expect(verifySession(`${payload}.${sig}`)).toBeNull()
  })
})

describe("session expiry", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("signs sessions with a future exp, and accepts them", () => {
    const token = signSession(USER)
    const [payload] = token.split(".")
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))

    expect(parsed.exp).toBeGreaterThan(Date.now())
    expect(parsed.exp).toBeLessThanOrEqual(Date.now() + SESSION_MAX_AGE_SECONDS * 1000)
    expect(verifySession(token)).toEqual(USER)
  })

  it("rejects an expired token even with a valid signature", () => {
    const expired = signRaw({ ...USER, exp: Date.now() - 1000 })
    expect(verifySession(expired)).toBeNull()
  })

  it("accepts a token right up until its exp, then rejects it once past", () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)

    const token = signSession(USER)

    vi.setSystemTime(SESSION_MAX_AGE_SECONDS * 1000 - 1)
    expect(verifySession(token)).toEqual(USER)

    vi.setSystemTime(SESSION_MAX_AGE_SECONDS * 1000)
    expect(verifySession(token)).toBeNull()
  })

  it("rejects legacy tokens signed before the exp field existed (no grace period)", () => {
    // Policy: a signed payload with no `exp` at all is treated the same as an
    // expired token, not honored for a grace period — see the doc comment on
    // verifySession(). This also covers a forged payload that omits `exp`.
    const legacy = signRaw(USER)
    expect(verifySession(legacy)).toBeNull()
  })

  it("rejects a token with a non-numeric exp", () => {
    const malformed = signRaw({ ...USER, exp: "not-a-number" })
    expect(verifySession(malformed)).toBeNull()
  })
})
