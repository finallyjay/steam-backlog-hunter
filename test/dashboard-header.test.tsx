// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { routerPushSpy, clearUserSpy, pathnameRef } = vi.hoisted(() => ({
  routerPushSpy: vi.fn(),
  clearUserSpy: vi.fn(),
  pathnameRef: { current: "/dashboard" },
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushSpy }),
  usePathname: () => pathnameRef.current,
}))

vi.mock("@/hooks/use-current-user", () => ({
  clearCurrentUser: clearUserSpy,
  useCurrentUser: () => ({ user: null, loading: false }),
}))

vi.mock("@/hooks/use-steam-data", () => ({
  invalidateSteamData: vi.fn(),
}))

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
  toast: vi.fn(),
}))

import { DashboardHeader } from "@/components/dashboard/dashboard-header"

const mockUser = {
  steamId: "76561198023709299",
  displayName: "Jay",
  avatar: "https://example.com/a.jpg",
  profileUrl: "https://steamcommunity.com/id/finallyjay",
}

const ORIGINAL_FETCH = globalThis.fetch

beforeEach(() => {
  routerPushSpy.mockClear()
  clearUserSpy.mockClear()
  pathnameRef.current = "/dashboard"
  globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as unknown as Response)
})

afterEach(() => {
  cleanup()
  globalThis.fetch = ORIGINAL_FETCH
  vi.clearAllMocks()
})

describe("DashboardHeader", () => {
  it("renders the user's display name and avatar", () => {
    render(<DashboardHeader user={mockUser} />)
    expect(screen.getByText("Jay")).toBeInTheDocument()
    expect(screen.getByAltText("Jay's Steam avatar")).toBeInTheDocument()
  })

  it("renders navigation links", () => {
    render(<DashboardHeader user={mockUser} />)
    expect(screen.getAllByText("Dashboard")[0]).toBeInTheDocument()
    expect(screen.getAllByText("Library")[0]).toBeInTheDocument()
  })

  it("marks the current pathname's link as active", () => {
    pathnameRef.current = "/games"
    const { container } = render(<DashboardHeader user={mockUser} />)
    const activeLink = container.querySelector('a[href="/games"]')
    expect(activeLink?.className).toContain("bg-accent")
  })

  it("logs the user out when the Logout button is clicked", async () => {
    render(<DashboardHeader user={mockUser} />)
    const logoutButton = screen.getByRole("button", { name: /logout/i })
    fireEvent.click(logoutButton)

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/auth/logout", { method: "POST" })
      expect(clearUserSpy).toHaveBeenCalled()
      expect(routerPushSpy).toHaveBeenCalledWith("/")
    })
  })

  it("swallows logout errors (no crash)", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network")
    })
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    render(<DashboardHeader user={mockUser} />)
    fireEvent.click(screen.getByRole("button", { name: /logout/i }))
    await waitFor(() => expect(consoleSpy).toHaveBeenCalled())
    consoleSpy.mockRestore()
  })

  it("toggles the mobile menu open and closed", () => {
    render(<DashboardHeader user={mockUser} />)
    const menuButton = screen.getByRole("button", { name: /open menu/i })
    fireEvent.click(menuButton)
    expect(screen.getByRole("button", { name: /close menu/i })).toBeInTheDocument()
    // Two "Dashboard" links now (top bar + mobile drawer)
    expect(screen.getAllByText("Dashboard").length).toBeGreaterThan(1)
    fireEvent.click(screen.getByRole("button", { name: /close menu/i }))
    expect(screen.getByRole("button", { name: /open menu/i })).toBeInTheDocument()
  })

  it("renders nothing when the user prop is falsy", () => {
    const { container } = render(<DashboardHeader user={null as unknown as typeof mockUser} />)
    expect(container.firstChild).toBeNull()
  })
})
