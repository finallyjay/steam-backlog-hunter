import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { GameCard } from "@/components/ui/game-card"

describe("GameCard", () => {
  afterEach(() => {
    cleanup()
  })

  it("renders achievement progress", () => {
    render(
      <GameCard
        id={730}
        name="CS2"
        image="/steam-icon.png"
        playtime={10}
        achievements={[
          {
            apiname: "ach_1",
            achieved: 1,
            unlocktime: 1,
            displayName: "Achievement 1",
            description: "",
            icon: "",
            icongray: "",
            hidden: 0,
            globalPercent: null,
          },
          {
            apiname: "ach_2",
            achieved: 0,
            unlocktime: 0,
            displayName: "Achievement 2",
            description: "",
            icon: "",
            icongray: "",
            hidden: 0,
            globalPercent: null,
          },
        ]}
      />,
    )

    expect(screen.getByText("CS2")).toBeInTheDocument()
    expect(screen.getByText("1/2 (50%)")).toBeInTheDocument()
  })

  it("renders completed game state", () => {
    const { container } = render(
      <GameCard
        id={730}
        name="CS2"
        image="/steam-icon.png"
        playtime={50}
        achievements={[
          {
            apiname: "ach_1",
            achieved: 1,
            unlocktime: 1,
            displayName: "Achievement 1",
            description: "",
            icon: "",
            icongray: "",
            hidden: 0,
            globalPercent: null,
          },
          {
            apiname: "ach_2",
            achieved: 1,
            unlocktime: 2,
            displayName: "Achievement 2",
            description: "",
            icon: "",
            icongray: "",
            hidden: 0,
            globalPercent: null,
          },
        ]}
      />,
    )

    expect(screen.getByText("2/2 (100%)")).toBeInTheDocument()
    expect(container.querySelector(".bg-success\\/10")).toBeInTheDocument()
  })

  it("renders game with no achievements", () => {
    render(<GameCard id={440} name="TF2" image="/steam-icon.png" playtime={5} achievements={[]} />)

    expect(screen.getByText("TF2")).toBeInTheDocument()
    expect(screen.getByText("-")).toBeInTheDocument()
  })

  it("renders game without playtime", () => {
    render(
      <GameCard
        id={440}
        name="TF2"
        image="/steam-icon.png"
        achievements={[
          {
            apiname: "ach_1",
            achieved: 0,
            unlocktime: 0,
            displayName: "Achievement 1",
            description: "",
            icon: "",
            icongray: "",
            hidden: 0,
            globalPercent: null,
          },
        ]}
      />,
    )

    expect(screen.getByText("TF2")).toBeInTheDocument()
    expect(screen.queryByText(/hours/)).not.toBeInTheDocument()
  })

  it("renders with serverTotal/serverUnlocked when no achievements array", () => {
    render(
      <GameCard id={570} name="Dota 2" image="/steam-icon.png" playtime={200} serverTotal={10} serverUnlocked={7} />,
    )

    expect(screen.getByText("Dota 2")).toBeInTheDocument()
    expect(screen.getByText("7/10 (70%)")).toBeInTheDocument()
  })

  it("shows formatPlaytime output for playtime", () => {
    render(<GameCard id={570} name="Dota 2" image="/steam-icon.png" playtime={14.5} achievements={[]} />)

    expect(screen.getByText("14h 30m")).toBeInTheDocument()
  })

  it("shows completed state when serverPerfect is true", () => {
    const { container } = render(
      <GameCard
        id={570}
        name="Dota 2"
        image="/steam-icon.png"
        playtime={50}
        serverTotal={5}
        serverUnlocked={3}
        serverPerfect={true}
      />,
    )

    expect(container.querySelector(".bg-success\\/10")).toBeInTheDocument()
  })

  it("shows loading state when achievementsLoading is true", () => {
    render(<GameCard id={730} name="CS2" image="/steam-icon.png" playtime={10} achievementsLoading={true} />)

    expect(screen.getByText("Loading achievements...")).toBeInTheDocument()
  })

  it("renders as a link when href is provided", () => {
    const { container } = render(
      <GameCard id={730} name="CS2" image="/steam-icon.png" playtime={10} href="/game/730" achievements={[]} />,
    )

    const link = container.querySelector("a")
    expect(link).toBeInTheDocument()
    expect(link?.getAttribute("href")).toBe("/game/730")
  })

  it("renders without link when href is not provided", () => {
    const { container } = render(
      <GameCard id={730} name="CS2" image="/steam-icon.png" playtime={10} achievements={[]} />,
    )

    expect(container.querySelector("a")).not.toBeInTheDocument()
  })

  it("calls onHide when hide button is clicked", () => {
    const onHide = vi.fn()
    const { container } = render(
      <GameCard id={730} name="CS2" image="/steam-icon.png" playtime={10} achievements={[]} onHide={onHide} />,
    )

    const hideButton = container.querySelector("button[aria-label='Hide CS2']")
    expect(hideButton).toBeInTheDocument()
    expect(hideButton?.className).toContain("focus-visible:opacity-100")
    expect(hideButton?.className).toContain("pointer-events-none")
    expect(hideButton?.className).toContain("group-hover:pointer-events-auto")
    fireEvent.click(hideButton!)

    expect(onHide).toHaveBeenCalledWith(730)
  })

  it("uses fallback image on error", () => {
    render(<GameCard id={730} name="CS2" image="/nonexistent.png" playtime={10} achievements={[]} />)

    // Two imgs exist (portrait for mobile, landscape for sm+). Pick the
    // landscape one — it's the only one whose primary src matches the
    // explicit `image` prop we passed in.
    const imgs = screen.getAllByAltText("Cover art for CS2") as HTMLImageElement[]
    const landscape = imgs.find((el) => el.src.includes("/nonexistent.png"))!
    expect(landscape).toBeDefined()

    fireEvent.error(landscape)

    // After first error, should switch to the header.jpg CDN fallback.
    expect(landscape.src).toContain("header.jpg")
  })

  it("shows warning color for mid-range completion", () => {
    const { container } = render(
      <GameCard id={730} name="CS2" image="/steam-icon.png" playtime={10} serverTotal={10} serverUnlocked={5} />,
    )

    expect(screen.getByText("5/10 (50%)")).toBeInTheDocument()
    expect(container.querySelector(".bg-warning")).toBeInTheDocument()
  })

  it("shows success color for high completion", () => {
    const { container } = render(
      <GameCard id={730} name="CS2" image="/steam-icon.png" playtime={10} serverTotal={10} serverUnlocked={9} />,
    )

    expect(screen.getByText("9/10 (90%)")).toBeInTheDocument()
    expect(container.querySelector(".bg-success")).toBeInTheDocument()
  })
})
