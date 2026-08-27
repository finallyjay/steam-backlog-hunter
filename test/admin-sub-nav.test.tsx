// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const pathnameRef = { current: "/admin" }

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameRef.current,
}))

import { AdminSubNav } from "@/components/admin/admin-sub-nav"

beforeEach(() => {
  pathnameRef.current = "/admin"
})

afterEach(() => {
  cleanup()
})

describe("AdminSubNav", () => {
  it("renders a nav landmark with both tab links", () => {
    render(<AdminSubNav />)
    expect(screen.getByRole("navigation", { name: "Admin sections" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Users/i })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Orphan names/i })).toBeInTheDocument()
  })

  it("points each link at the correct href", () => {
    render(<AdminSubNav />)
    expect(screen.getByRole("link", { name: /Users/i })).toHaveAttribute("href", "/admin")
    expect(screen.getByRole("link", { name: /Orphan names/i })).toHaveAttribute("href", "/admin/orphan-names")
  })

  it("marks the Users tab active when on /admin", () => {
    pathnameRef.current = "/admin"
    render(<AdminSubNav />)
    const usersLink = screen.getByRole("link", { name: /Users/i })
    const orphanLink = screen.getByRole("link", { name: /Orphan names/i })
    expect(usersLink.className).toContain("bg-accent")
    expect(orphanLink.className).not.toContain("bg-accent")
  })

  it("marks the Orphan names tab active when on /admin/orphan-names", () => {
    pathnameRef.current = "/admin/orphan-names"
    render(<AdminSubNav />)
    const usersLink = screen.getByRole("link", { name: /Users/i })
    const orphanLink = screen.getByRole("link", { name: /Orphan names/i })
    expect(orphanLink.className).toContain("bg-accent")
    expect(usersLink.className).not.toContain("bg-accent")
  })

  it("marks neither tab active on an unrelated route", () => {
    pathnameRef.current = "/dashboard"
    render(<AdminSubNav />)
    const usersLink = screen.getByRole("link", { name: /Users/i })
    const orphanLink = screen.getByRole("link", { name: /Orphan names/i })
    expect(usersLink.className).not.toContain("bg-accent")
    expect(orphanLink.className).not.toContain("bg-accent")
  })
})
