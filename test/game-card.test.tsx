import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { GameCard } from "@/components/ui/game-card"

describe("GameCard", () => {
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
})
