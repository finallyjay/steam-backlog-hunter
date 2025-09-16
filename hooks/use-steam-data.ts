"use client"

import { useState, useEffect } from "react"
import type { SteamGame } from "@/lib/steam-api"

interface SteamStats {
  totalGames: number
  totalAchievements: number
  totalPlaytime: number
  perfectGames: number
}

export function useSteamGames(type: "recent" | "all" = "recent") {
  const [games, setGames] = useState<SteamGame[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchGames() {
      try {
        setLoading(true)
        const response = await fetch(`/api/steam/games?type=${type}`)

        if (!response.ok) {
          throw new Error("Failed to fetch games")
        }

        const data = await response.json()
        setGames(data.games || [])
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error")
      } finally {
        setLoading(false)
      }
    }

    fetchGames()
  }, [type])

  return { games, loading, error }
}

export function useSteamStats() {
  const [stats, setStats] = useState<SteamStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchStats() {
      try {
        setLoading(true)
        const response = await fetch("/api/steam/stats")

        if (!response.ok) {
          throw new Error("Failed to fetch stats")
        }

        const data = await response.json()
        setStats(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error")
      } finally {
        setLoading(false)
      }
    }

    fetchStats()
  }, [])

  return { stats, loading, error }
}

export function useSteamAchievements(appId: number | null) {
  const [achievements, setAchievements] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!appId) return

    async function fetchAchievements() {
      try {
        setLoading(true)
        const response = await fetch(`/api/steam/achievements?appId=${appId}`)

        if (!response.ok) {
          throw new Error("Failed to fetch achievements")
        }

        const data = await response.json()
        setAchievements(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error")
      } finally {
        setLoading(false)
      }
    }

    fetchAchievements()
  }, [appId])

  return { achievements, loading, error }
}
