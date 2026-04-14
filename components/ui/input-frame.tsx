import * as React from "react"

import { cn } from "@/lib/utils"

// InputFrame is the bordered h-9 wrapper used to host a search-style input
// with an optional leading icon. Catalogued as "Shape 4" in issue #181 — the
// focus-within-border-accent pattern that repeats across the library filter
// search box and the extras search box.
//
// Usage:
//   <InputFrame>
//     <Search className="text-muted-foreground h-4 w-4 shrink-0" />
//     <input type="text" ... className="text-foreground placeholder:text-muted-foreground h-full w-full bg-transparent text-sm focus:outline-none" />
//   </InputFrame>
//
// Layout-level concerns (flex-1, min-w-0, full-width in a grid cell, etc.)
// stay with the caller via className — the component only owns the visual
// identity of the frame itself.
function InputFrame({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-frame"
      className={cn(
        // focus-within:ring-2 gives the inner <input> a real WCAG 1.4.11
        // focus indicator. The hosted input typically kills its own outline
        // via `outline-none`, and the 1px accent border alone isn't a
        // strong enough cue. The ring on the parent frame replaces it.
        "border-surface-4 bg-surface-1 focus-within:border-accent focus-within:ring-accent/50 flex h-9 items-center gap-2 rounded-lg border px-3 transition-colors focus-within:ring-2",
        className,
      )}
      {...props}
    />
  )
}

export { InputFrame }
