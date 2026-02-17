"use client"

import { useState, useEffect } from "react"
import type { SteamGame } from "@/lib/steam-api"

type SteamGameDetailResponse = { game: SteamGame } | { error: string }

export function useSteamGameDetail(appId: number | null) {
  const [game, setGame] = useState<SteamGame | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!appId) return

    async function fetchGameDetail() {
      try {
        setLoading(true)
        const response = await fetch(`/api/steam/game/${appId}`)
        if (!response.ok) throw new Error("Failed to fetch game detail")
        const data = (await response.json()) as SteamGameDetailResponse
        if (!("game" in data)) {
          throw new Error("Invalid game detail response")
        }
        setGame(data.game)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error")
      } finally {
        setLoading(false)
      }
    }

    void fetchGameDetail()
  }, [appId])

  return { game, loading, error }
}
