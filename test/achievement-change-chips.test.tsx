// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { AchievementChangeChips } from "@/components/ui/achievement-change-chips"
import { AchievementRow } from "@/components/ui/achievement-row"

afterEach(() => {
  cleanup()
})

describe("AchievementChangeChips", () => {
  it("renders nothing when there is no change", () => {
    const { container } = render(<AchievementChangeChips added={0} removed={0} wasPerfect={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("renders one chip per non-empty dimension", () => {
    render(<AchievementChangeChips added={3} removed={1} wasPerfect />)
    expect(screen.getByText("+3 new")).toBeInTheDocument()
    expect(screen.getByText("1 retired")).toBeInTheDocument()
    expect(screen.getByText("Was perfect")).toBeInTheDocument()
  })
})

describe("AchievementRow isNew", () => {
  const base = {
    apiname: "ACH_NEW",
    achieved: 0,
    unlocktime: 0,
    displayName: "Brand new",
    description: "",
    icon: "",
    icongray: "",
    hidden: 0,
    globalPercent: null,
  }

  it("shows a New chip when flagged", () => {
    render(
      <ul>
        <AchievementRow achievement={base} isNew />
      </ul>,
    )
    expect(screen.getByLabelText("New achievement")).toBeInTheDocument()
  })

  it("shows the chip on hidden rows too", () => {
    render(
      <ul>
        <AchievementRow achievement={{ ...base, hidden: 1 }} isNew />
      </ul>,
    )
    expect(screen.getByLabelText("New achievement")).toBeInTheDocument()
    expect(screen.getByText("Logro oculto")).toBeInTheDocument()
  })

  it("omits the chip by default", () => {
    render(
      <ul>
        <AchievementRow achievement={base} />
      </ul>,
    )
    expect(screen.queryByLabelText("New achievement")).not.toBeInTheDocument()
  })
})
