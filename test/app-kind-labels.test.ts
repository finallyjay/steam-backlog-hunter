import { describe, expect, it } from "vitest"

import { appKindLabel, filterByKind, isGameLikeKind } from "@/lib/app-kind-labels"

describe("app kind labels", () => {
  it("labels known kinds and passes unknown values through", () => {
    expect(appKindLabel("demo")).toBe("Demo")
    expect(appKindLabel("dlc")).toBe("DLC")
    expect(appKindLabel(null)).toBe("Unknown")
    expect(appKindLabel("future-kind")).toBe("future-kind")
  })

  it("treats game and unknown (and missing) as game-like", () => {
    expect(isGameLikeKind("game")).toBe(true)
    expect(isGameLikeKind("unknown")).toBe(true)
    expect(isGameLikeKind(undefined)).toBe(true)
    expect(isGameLikeKind("demo")).toBe(false)
    expect(isGameLikeKind("tool")).toBe(false)
  })

  it("filterByKind hides non-game kinds unless showAll", () => {
    const items = [
      { appid: 1, kind: "game" },
      { appid: 2, kind: "demo" },
      { appid: 3, kind: "unknown" },
      { appid: 4, kind: "tool" },
    ]
    expect(filterByKind(items, false).map((i) => i.appid)).toEqual([1, 3])
    expect(filterByKind(items, true)).toBe(items)
  })
})
