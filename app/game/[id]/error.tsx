"use client"

import { useEffect } from "react"

export default function GameError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Game detail error:", error)
  }, [error])
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <h2 className="text-foreground text-2xl font-semibold">Something went wrong</h2>
      <p className="text-muted-foreground max-w-md text-sm">
        An error occurred while loading this game. This may be a temporary issue — please try again.
      </p>
      <button
        onClick={reset}
        className="bg-surface-4 text-foreground mt-2 rounded-md px-4 py-2 text-sm font-medium transition-colors hover:bg-white/20"
      >
        Try again
      </button>
    </div>
  )
}
