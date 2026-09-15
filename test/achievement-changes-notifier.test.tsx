// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { AchievementChangeView } from "@/lib/types/steam"

const { useAchievementChangesMock, toastMock, pushMock } = vi.hoisted(() => ({
  useAchievementChangesMock: vi.fn(),
  toastMock: vi.fn(),
  pushMock: vi.fn(),
}))

vi.mock("@/hooks/use-achievement-changes", () => ({
  useAchievementChanges: useAchievementChangesMock,
}))

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn(), toasts: [] }),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}))

import { AchievementChangesNotifier } from "@/components/achievement-changes-notifier"

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

function hookReturn(unseen: AchievementChangeView[], loading = false) {
  return {
    changes: unseen,
    unseen,
    byAppId: new Map(),
    loading,
    error: null,
    markSeen: vi.fn(),
    refetch: vi.fn(),
  }
}

beforeEach(() => {
  window.sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("AchievementChangesNotifier", () => {
  it("does nothing while loading or without unseen changes", () => {
    useAchievementChangesMock.mockReturnValue(hookReturn([change({})], true))
    render(<AchievementChangesNotifier />)
    expect(toastMock).not.toHaveBeenCalled()
    cleanup()

    useAchievementChangesMock.mockReturnValue(hookReturn([]))
    render(<AchievementChangesNotifier />)
    expect(toastMock).not.toHaveBeenCalled()
  })

  it("fires one toast summarising unseen changes and routes to the library filter", () => {
    useAchievementChangesMock.mockReturnValue(
      hookReturn([
        change({ id: 1, added: ["A", "B"], wasPerfect: true }),
        change({ id: 2, appId: 730, gameName: "CS2", added: [], removed: ["OLD"] }),
      ]),
    )
    render(<AchievementChangesNotifier />)

    expect(toastMock).toHaveBeenCalledTimes(1)
    const call = toastMock.mock.calls[0]?.[0] as { title: string; description: string; action: React.ReactElement }
    expect(call.title).toBe("Achievements changed")
    expect(call.description).toBe("2 new achievements, 1 retired across 2 games. 1 perfect game is no longer 100%.")

    const actionProps = call.action.props as { onClick: () => void }
    actionProps.onClick()
    expect(pushMock).toHaveBeenCalledWith("/games?filter=new-achievements")
  })

  it("does not re-announce the same unseen set across remounts in one session", () => {
    useAchievementChangesMock.mockReturnValue(hookReturn([change({ id: 1 })]))
    render(<AchievementChangesNotifier />)
    expect(toastMock).toHaveBeenCalledTimes(1)
    cleanup()

    render(<AchievementChangesNotifier />)
    expect(toastMock).toHaveBeenCalledTimes(1)
  })

  it("announces again when a new change appears", () => {
    useAchievementChangesMock.mockReturnValue(hookReturn([change({ id: 1 })]))
    const { rerender } = render(<AchievementChangesNotifier />)
    expect(toastMock).toHaveBeenCalledTimes(1)

    useAchievementChangesMock.mockReturnValue(hookReturn([change({ id: 1 }), change({ id: 2, appId: 730 })]))
    rerender(<AchievementChangesNotifier />)
    expect(toastMock).toHaveBeenCalledTimes(2)
  })
})
