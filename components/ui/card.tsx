import * as React from "react"

import { cn } from "@/lib/utils"

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "bg-card text-card-foreground border-surface-4 flex flex-col gap-6 rounded-xl border py-6 shadow-[0_18px_70px_-35px_rgba(15,23,42,0.95)] backdrop-blur-xl",
        className,
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6",
        className,
      )}
      {...props}
    />
  )
}

type CardTitleElement = "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "div"

/**
 * CardTitle defaults to <h3> so it shows up in screen reader heading
 * navigation (rotor / cmd+opt+u). Cards typically live inside a section
 * with a higher-level heading (h1 page title + h2 section), so h3 is the
 * sensible mid-level. Override via `as` for cases where the inner content
 * already contains a real heading (use `as="div"`) or the card is the
 * top-level section heading on its page (use `as="h2"`).
 */
function CardTitle({
  as: Component = "h3",
  className,
  ...props
}: React.ComponentProps<"div"> & { as?: CardTitleElement }) {
  return <Component data-slot="card-title" className={cn("leading-none font-semibold", className)} {...props} />
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-description" className={cn("text-muted-foreground text-sm", className)} {...props} />
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("px-6", className)} {...props} />
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-footer" className={cn("flex items-center px-6 [.border-t]:pt-6", className)} {...props} />
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent }
