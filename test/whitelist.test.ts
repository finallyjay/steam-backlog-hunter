import { afterEach, describe, expect, it } from "vitest"

import { getSteamWhitelist, isSteamIdWhitelisted } from "@/lib/whitelist"

const ORIGINAL_ENV = process.env.STEAM_WHITELIST_IDS

describe("whitelist", () => {
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.STEAM_WHITELIST_IDS
    } else {
      process.env.STEAM_WHITELIST_IDS = ORIGINAL_ENV
    }
  })

  it("parses ids from comma-separated env value", () => {
    process.env.STEAM_WHITELIST_IDS = "76561198000000000, 76561198000000001, ,"

    const whitelist = getSteamWhitelist()

    expect(whitelist.has("76561198000000000")).toBe(true)
    expect(whitelist.has("76561198000000001")).toBe(true)
    expect(whitelist.size).toBe(2)
  })

  it("denies all users when env is empty", () => {
    delete process.env.STEAM_WHITELIST_IDS

    expect(isSteamIdWhitelisted("76561198000000000")).toBe(false)
  })

  it("allows whitelisted user", () => {
    process.env.STEAM_WHITELIST_IDS = "76561198000000000,76561198000000001"

    expect(isSteamIdWhitelisted("76561198000000000")).toBe(true)
  })
})
