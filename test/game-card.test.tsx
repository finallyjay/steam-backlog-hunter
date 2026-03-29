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
    expect(container.querySelector(".bg-emerald-500\\/10")).toBeInTheDocument()
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
})
