import { render, screen, cleanup } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

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
          },
          {
            apiname: "ach_2",
            achieved: 0,
            unlocktime: 0,
            displayName: "Achievement 2",
            description: "",
            icon: "",
            icongray: "",
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
          },
          {
            apiname: "ach_2",
            achieved: 1,
            unlocktime: 2,
            displayName: "Achievement 2",
            description: "",
            icon: "",
            icongray: "",
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
})
