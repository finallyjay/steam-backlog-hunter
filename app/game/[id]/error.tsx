"use client"

import { useEffect } from "react"

export default function GameError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Game detail error:", error)
  }, [error])
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <h2 className="text-2xl font-semibold text-white">Something went wrong</h2>
      <p className="max-w-md text-sm text-neutral-400">
        An error occurred while loading this game. This may be a temporary issue — please try again.
      </p>
      <button
        onClick={reset}
        className="mt-2 rounded-md bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20"
      >
        Try again
      </button>
    </div>
  )
}
