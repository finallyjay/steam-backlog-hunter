import { describe, expect, it } from "vitest"

import { describeChangeSummary, summarizeUnseenChanges } from "@/lib/achievement-changes-summary"
import type { AchievementChangeView } from "@/lib/types/steam"

function change(overrides: Partial<AchievementChangeView>): AchievementChangeView {
  return {
    id: 1,
    appId: 620,
    gameName: "Portal 2",
    added: [],
    removed: [],
    totalBefore: 2,
    totalAfter: 3,
    wasPerfect: false,
    detectedAt: "2026-09-05T00:00:00.000Z",
    seenAt: null,
    ...overrides,
  }
}

describe("summarizeUnseenChanges", () => {
  it("ignores seen rows", () => {
    const map = summarizeUnseenChanges([change({ id: 1, added: ["A"], seenAt: "2026-09-06T00:00:00.000Z" })])
    expect(map.size).toBe(0)
  })

  it("merges multiple unseen rows for the same game", () => {
    const map = summarizeUnseenChanges([
      change({ id: 1, added: ["A"], wasPerfect: true }),
      change({ id: 2, added: ["B", "C"], removed: ["OLD"] }),
      change({ id: 3, appId: 730, gameName: "CS2", added: ["X"] }),
    ])
    expect(map.get(620)).toEqual({
      appId: 620,
      added: 3,
      removed: 1,
      wasPerfect: true,
      ids: [1, 2],
      addedApinames: ["A", "B", "C"],
    })
    expect(map.get(730)?.ids).toEqual([3])
  })
})

describe("describeChangeSummary", () => {
  it("formats added and retired counts", () => {
    expect(describeChangeSummary({ added: 2, removed: 0 })).toBe("+2 new")
    expect(describeChangeSummary({ added: 0, removed: 1 })).toBe("1 retired")
    expect(describeChangeSummary({ added: 2, removed: 1 })).toBe("+2 new · 1 retired")
    expect(describeChangeSummary({ added: 0, removed: 0 })).toBe("")
  })
})
