// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { AchievementChangeView } from "@/lib/types/steam"

const { useAchievementChangesMock } = vi.hoisted(() => ({
  useAchievementChangesMock: vi.fn(),
}))

vi.mock("@/hooks/use-achievement-changes", () => ({
  useAchievementChanges: useAchievementChangesMock,
}))

import { AchievementChangesPanel } from "@/components/dashboard/achievement-changes-panel"

function change(overrides: Partial<AchievementChangeView>): AchievementChangeView {
  return {
    id: 1,
    appId: 620,
    gameName: "Portal 2",
    added: ["ACH_NEW"],
    removed: [],
    totalBefore: 2,
    totalAfter: 3,
    wasPerfect: false,
    detectedAt: "2026-09-05T00:00:00.000Z",
    seenAt: null,
    ...overrides,
  }
}

function hookReturn(changes: AchievementChangeView[], overrides: Record<string, unknown> = {}) {
  return {
    changes,
    unseen: changes.filter((c) => !c.seenAt),
    byAppId: new Map(),
    loading: false,
    error: null,
    markSeen: vi.fn().mockResolvedValue(true),
    refetch: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  useAchievementChangesMock.mockReturnValue(hookReturn([]))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("AchievementChangesPanel", () => {
  it("renders nothing while loading, on error, or without changes", () => {
    useAchievementChangesMock.mockReturnValueOnce(hookReturn([], { loading: true }))
    const { container: a } = render(<AchievementChangesPanel />)
    expect(a).toBeEmptyDOMElement()
    cleanup()

    useAchievementChangesMock.mockReturnValueOnce(hookReturn([change({})], { error: "boom" }))
    const { container: b } = render(<AchievementChangesPanel />)
    expect(b).toBeEmptyDOMElement()
    cleanup()

    const { container: c } = render(<AchievementChangesPanel />)
    expect(c).toBeEmptyDOMElement()
  })

  it("lists changes with chips, a link to the game and an unseen counter", () => {
    useAchievementChangesMock.mockReturnValue(
      hookReturn([
        change({ id: 1, added: ["A", "B"], wasPerfect: true }),
        change({ id: 2, appId: 730, gameName: "CS2", added: [], removed: ["OLD"], totalBefore: 5, totalAfter: 4 }),
      ]),
    )
    render(<AchievementChangesPanel />)

    expect(screen.getByText("Achievement changes")).toBeInTheDocument()
    expect(screen.getByLabelText("2 unseen changes")).toBeInTheDocument()
    expect(screen.getByText("+2 new")).toBeInTheDocument()
    expect(screen.getByText("Was perfect")).toBeInTheDocument()
    expect(screen.getByText("1 retired")).toBeInTheDocument()
    expect(screen.getByText(/2 → 3 achievements · /)).toBeInTheDocument()
    expect(screen.getByText(/5 → 4 achievements · /)).toBeInTheDocument()

    const links = screen.getAllByRole("link")
    expect(links.some((l) => l.getAttribute("href") === "/game/620")).toBe(true)
    expect(links.some((l) => l.getAttribute("href") === "/games?filter=new-achievements")).toBe(true)
  })

  it("omits the before-count when it is unknown", () => {
    useAchievementChangesMock.mockReturnValue(hookReturn([change({ id: 1, totalBefore: null, totalAfter: 4 })]))
    render(<AchievementChangesPanel />)
    expect(screen.getByText(/^4 achievements · /)).toBeInTheDocument()
  })

  it("puts unseen rows first and dims seen ones", () => {
    useAchievementChangesMock.mockReturnValue(
      hookReturn([
        change({ id: 1, detectedAt: "2026-09-09T00:00:00.000Z", seenAt: "2026-09-10T00:00:00.000Z" }),
        change({ id: 2, appId: 730, gameName: "CS2", detectedAt: "2026-09-01T00:00:00.000Z" }),
      ]),
    )
    render(<AchievementChangesPanel />)

    const rows = screen.getAllByTestId(/achievement-change-/)
    expect(rows[0]).toHaveAttribute("data-testid", "achievement-change-2")
    expect(rows[1]).toHaveClass("opacity-60")
  })

  it("marks a single row and all rows as seen", async () => {
    const markSeen = vi.fn().mockResolvedValue(true)
    useAchievementChangesMock.mockReturnValue(
      hookReturn([change({ id: 1 }), change({ id: 2, appId: 730, gameName: "CS2" })], { markSeen }),
    )
    render(<AchievementChangesPanel />)

    fireEvent.click(screen.getByLabelText("Mark Portal 2 change as seen"))
    await waitFor(() => expect(markSeen).toHaveBeenCalledWith([1]))

    fireEvent.click(screen.getByRole("button", { name: /mark all as seen/i }))
    await waitFor(() => expect(markSeen).toHaveBeenCalledWith())
  })

  it("hides the mark-all action and library link when nothing is unseen", () => {
    useAchievementChangesMock.mockReturnValue(hookReturn([change({ id: 1, seenAt: "2026-09-06T00:00:00.000Z" })]))
    render(<AchievementChangesPanel />)

    expect(screen.queryByRole("button", { name: /mark all as seen/i })).not.toBeInTheDocument()
    expect(screen.queryByText("View in library")).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/unseen changes/)).not.toBeInTheDocument()
  })
})
