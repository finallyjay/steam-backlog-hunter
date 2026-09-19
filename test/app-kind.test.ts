// @vitest-environment node
import { describe, expect, it } from "vitest"

import { isAppKind, kindFromName, kindFromStoreType } from "@/lib/server/app-kind"

describe("kindFromStoreType", () => {
  it.each([
    ["game", "game"],
    ["Game", "game"],
    ["mod", "game"],
    ["demo", "demo"],
    ["dlc", "dlc"],
    ["tool", "software"],
    ["application", "software"],
    ["config", "software"],
    ["video", "other"],
    ["music", "other"],
    ["advertising", "other"],
    ["series", "other"],
    ["hardware", "other"],
  ])("maps store type %s to %s", (type, kind) => {
    expect(kindFromStoreType(type)).toBe(kind)
  })

  it("returns null for unknown or missing types", () => {
    expect(kindFromStoreType("")).toBeNull()
    expect(kindFromStoreType(undefined)).toBeNull()
    expect(kindFromStoreType(null)).toBeNull()
    expect(kindFromStoreType("something-new")).toBeNull()
  })
})

describe("kindFromName", () => {
  it.each([
    ["Rocksmith Demo", "demo"],
    ["Portal 2 - Demo", "demo"],
    ["Bright Memory: Infinite Prologue", "demo"],
    ["Counter-Strike: Source Beta", "beta"],
    ["Dota 2 Test", "beta"],
    ["Hunt: Showdown Test Server", "beta"],
    ["Halo Infinite Playtest", "beta"],
    ["Source Dedicated Server", "tool"],
    ["Steamworks SDK Redist", "tool"],
    ["Arma 3 Tools", "tool"],
    ["Creation Kit", "tool"],
    ["Unreal Development Kit", "tool"],
    ["Hades Original Soundtrack", "other"],
    ["Ori and the Blind Forest - OST", "other"],
    ["Cyberpunk 2077 Artbook", "other"],
  ])("classifies %s as %s", (name, kind) => {
    expect(kindFromName(name)).toBe(kind)
  })

  it("returns null for ordinary game titles so nothing is misfiled", () => {
    for (const name of [
      "Portal 2",
      "Test Drive Unlimited 2",
      "Alpha Protocol",
      "Betrayer",
      "Toolbox Murders",
      "Demolition Inc.",
      "Serious Sam: The Second Encounter",
    ]) {
      expect(kindFromName(name)).toBeNull()
    }
  })

  it("returns null for empty names", () => {
    expect(kindFromName("")).toBeNull()
    expect(kindFromName(null)).toBeNull()
    expect(kindFromName("   ")).toBeNull()
  })
})

describe("isAppKind", () => {
  it("accepts known kinds and rejects anything else", () => {
    expect(isAppKind("game")).toBe(true)
    expect(isAppKind("unknown")).toBe(true)
    expect(isAppKind("GAME")).toBe(false)
    expect(isAppKind(42)).toBe(false)
  })
})
