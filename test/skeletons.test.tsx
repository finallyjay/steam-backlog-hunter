// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { DashboardSkeleton } from "@/components/skeletons/dashboard-skeleton"
import { LibrarySkeleton } from "@/components/skeletons/library-skeleton"

afterEach(() => {
  cleanup()
})

// Smoke tests — these skeletons are purely visual (no hooks, no state, no
// async code) so a single render assertion is enough to catch accidental
// breakage like a typo in a className, a missing Fragment wrapper, or a
// removed prop. They also lift the files from 0% to 100% coverage since
// there are no branches to cover.
describe("skeletons", () => {
  it("DashboardSkeleton renders without throwing", () => {
    const { container } = render(<DashboardSkeleton />)
    expect(container.firstChild).not.toBeNull()
  })

  it("LibrarySkeleton renders without throwing", () => {
    const { container } = render(<LibrarySkeleton />)
    expect(container.firstChild).not.toBeNull()
  })
})
