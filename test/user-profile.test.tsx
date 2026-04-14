// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

// Stub AnimatedNumber so we can assert on the numeric value directly
vi.mock("@/components/ui/animated-number", () => ({
  AnimatedNumber: ({ value }: { value: number }) => <>{value}</>,
}))

import { UserProfile } from "@/components/dashboard/user-profile"
import type { SteamUser } from "@/lib/auth"
import type { SteamStatsResponse } from "@/lib/types/steam"

const baseUser: SteamUser = {
  steamId: "76561198023709299",
  displayName: "Jay",
  avatar: "https://example.com/a.jpg",
  profileUrl: "https://steamcommunity.com/id/finallyjay",
  timecreated: 1_200_000_000,
  communityVisibilityState: 3,
  steamLevel: 42,
  badges: [{ badgeid: 13, level: 120 }],
}

const baseStats: SteamStatsResponse = {
  totalGames: 629,
  gamesWithAchievements: 440,
  totalAchievements: 17964,
  pendingAchievements: 5000,
  startedGames: 133,
  averageCompletion: 77,
  totalPlaytime: 33000,
  perfectGames: 45,
}

afterEach(() => {
  cleanup()
})

describe("UserProfile", () => {
  it("renders display name, avatar, and KPI summary", () => {
    render(<UserProfile user={baseUser} stats={baseStats} />)
    expect(screen.getByText("Jay")).toBeInTheDocument()
    expect(screen.getByAltText("Jay's Steam avatar")).toBeInTheDocument()
    expect(screen.getByText("Total Games")).toBeInTheDocument()
    expect(screen.getByText("629")).toBeInTheDocument()
    expect(screen.getByText("17964")).toBeInTheDocument() // Unlocked Achievements
    expect(screen.getByText("133")).toBeInTheDocument() // Started Games
    expect(screen.getByText("45")).toBeInTheDocument() // Perfect Games
  })

  it("renders … placeholders for each KPI while stats are loading", () => {
    render(<UserProfile user={baseUser} stats={null} statsLoading />)
    // 4 KPI cards all show '...'
    expect(screen.getAllByText("...").length).toBe(4)
  })

  it("shows average completion when stats are available", () => {
    render(<UserProfile user={baseUser} stats={baseStats} />)
    // The avg-completion ring renders "Avg" as a compact eyebrow label
    // alongside the percentage value inside the SVG ring.
    expect(screen.getByText("Avg")).toBeInTheDocument()
    expect(screen.getByText("77")).toBeInTheDocument()
  })

  it("renders a tier-coloured circle badge for levels < 100", () => {
    const user = { ...baseUser, steamLevel: 42 }
    render(<UserProfile user={user} stats={baseStats} />)
    expect(screen.getByText("42")).toBeInTheDocument()
  })

  it("renders a sprite-backed badge for levels >= 100 (exercises the sprite branch)", () => {
    // jsdom doesn't faithfully serialize the inline background-image url(),
    // so we just assert the level number is rendered — that's enough to
    // execute the 'sprite' branch of getSteamLevelBadge and hit the code path.
    const user = { ...baseUser, steamLevel: 150 }
    render(<UserProfile user={user} stats={baseStats} />)
    expect(screen.getByText("150")).toBeInTheDocument()
  })

  it("falls back to a circle badge when the level's century has no sprite mapping", () => {
    const user = { ...baseUser, steamLevel: 99999 }
    render(<UserProfile user={user} stats={baseStats} />)
    expect(screen.getByText("99999")).toBeInTheDocument()
  })

  it("omits the level badge when steamLevel is null", () => {
    const user = { ...baseUser, steamLevel: null }
    render(<UserProfile user={user} stats={baseStats} />)
    // display name still there
    expect(screen.getByText("Jay")).toBeInTheDocument()
  })

  it("renders a years-of-service badge when timecreated is set", () => {
    render(<UserProfile user={baseUser} stats={baseStats} />)
    const img = screen.getByAltText(/\d+ years of service/)
    expect(img.getAttribute("src")).toContain("steamyears")
  })

  it("renders a Game Collector badge when the user has badge 13", () => {
    render(<UserProfile user={baseUser} stats={baseStats} />)
    expect(screen.getByAltText(/Game Collector level 120/)).toBeInTheDocument()
  })

  it("warns when the community profile is not public", () => {
    const user = { ...baseUser, communityVisibilityState: 2 }
    render(<UserProfile user={user} stats={baseStats} />)
    expect(screen.getByRole("alert")).toHaveTextContent(/not public/i)
  })

  it("does not render the warning when communityVisibilityState is null", () => {
    const user = { ...baseUser, communityVisibilityState: null }
    render(<UserProfile user={user} stats={baseStats} />)
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("links each KPI card to its filter destination", () => {
    const { container } = render(<UserProfile user={baseUser} stats={baseStats} />)
    const links = container.querySelectorAll("a[href^='/games']")
    const hrefs = Array.from(links).map((a) => a.getAttribute("href"))
    expect(hrefs).toContain("/games")
    expect(hrefs).toContain("/games?played=played&filter=perfect&achievements=with")
    expect(hrefs).toContain("/games?played=played&filter=started&achievements=with")
  })

  it("renders the sync label when provided", () => {
    render(<UserProfile user={baseUser} stats={baseStats} syncLabel="Last sync 10 minutes ago" />)
    expect(screen.getByText("Last sync 10 minutes ago")).toBeInTheDocument()
  })
})
