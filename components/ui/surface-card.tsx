import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// SurfaceCard consolidates the five bordered-surface shapes that were
// previously inlined in ~15 places across the repo. The CVA variants map
// directly to the six clusters catalogued in issue #181:
//
//   default       — subcard (border, p-4)
//   row           — list row (border, px-4 py-4)
//   empty         — empty state (border, px-6 py-10, centered text)
//   metric        — borderless metric row (px-3 py-2.5, flex layout)
//   admin-item    — admin item (border, px-4 py-3, flex layout)
//
// Hover variants handle the "accent highlight on hover" case used by
// interactive rows (user-profile stats, clickable cards).
//
// Callers can still pass className for layout-level concerns that aren't
// part of the surface identity (flex-1, min-w-0, backdrop-blur-sm, etc.).
const surfaceCardVariants = cva("bg-surface-1 rounded-lg transition-colors", {
  variants: {
    variant: {
      default: "border-surface-4 border p-4",
      row: "border-surface-4 border px-4 py-4",
      empty: "border-surface-4 border px-6 py-10 text-center",
      metric: "flex items-center justify-between px-3 py-2.5",
      "admin-item": "border-surface-4 flex items-center gap-4 border px-4 py-3",
    },
    hover: {
      none: "",
      accent: "hover:border-accent/30 hover:bg-surface-2",
    },
  },
  defaultVariants: {
    variant: "default",
    hover: "none",
  },
})

function SurfaceCard({
  className,
  variant,
  hover,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof surfaceCardVariants>) {
  return <div data-slot="surface-card" className={cn(surfaceCardVariants({ variant, hover }), className)} {...props} />
}

export { SurfaceCard, surfaceCardVariants }
