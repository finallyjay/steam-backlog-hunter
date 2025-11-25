"use client"

import { useState, useEffect } from "react"

// Hook to fetch achievements for multiple games in a batch
export function useSteamAchievementsBatch(appIds: number[]) {
  const [achievementsMap, setAchievementsMap] = useState<Record<number, any[]>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!appIds || appIds.length === 0) return
    async function fetchBatch() {
      setLoading(true)
      try {
        // Load allowed games list from public JSON
        const jsonRes = await fetch("/steam_games_with_achievements.json")
        const steamGamesList = await jsonRes.json()
        const allowedIds = new Set(steamGamesList.map((g: any) => String(g.id)))
        const filteredAppIds = appIds.filter(id => allowedIds.has(String(id)))
        const results: Record<number, any[]> = {}
        await Promise.all(filteredAppIds.map(async (appId) => {
          try {
            const response = await fetch(`/api/steam/achievements?appId=${appId}`)
            if (!response.ok) throw new Error("Failed to fetch achievements")
            const data = await response.json()
            results[appId] = Array.isArray(data.achievements) ? data.achievements : []
          } catch {
            results[appId] = []
          }
        }))
        setAchievementsMap(results)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error")
        setAchievementsMap({})
      } finally {
        setLoading(false)
      }
    }
    fetchBatch()
  }, [JSON.stringify(appIds)])
  return { achievementsMap, loading, error }
}
import type { SteamGame } from "@/lib/steam-api"
// Load allowed games list from public JSON

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
        // Obtener la lista de juegos permitidos desde public
        const jsonRes = await fetch("/steam_games_with_achievements.json")
        const steamGamesList = await jsonRes.json()
        const allowedIds = new Set(steamGamesList.map((g: any) => String(g.id)))
        const filteredGames = (data.games || []).filter((game: SteamGame) => allowedIds.has(String(game.appid)))
        setGames(filteredGames)
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
  const [achievements, setAchievements] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!appId) return
    async function fetchAchievementsFiltered() {
      // Obtener la lista de juegos permitidos desde public
      const jsonRes = await fetch("/steam_games_with_achievements.json")
      const steamGamesList = await jsonRes.json()
      const allowedIds = new Set(steamGamesList.map((g: any) => String(g.id)))
      if (!allowedIds.has(String(appId))) {
        setAchievements([])
        return
      }
      try {
        setLoading(true)
        const response = await fetch(`/api/steam/achievements?appId=${appId}`)
        if (!response.ok) throw new Error("Failed to fetch achievements")
        const data = await response.json()
        setAchievements(Array.isArray(data.achievements) ? data.achievements : [])
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error")
        setAchievements([])
      } finally {
        setLoading(false)
      }
    }
    fetchAchievementsFiltered()
  }, [appId])
  return { achievements, loading, error }
}
