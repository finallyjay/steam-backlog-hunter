"use client"

import { useEffect, useMemo, useState } from "react"

import { getAllowedGameIdsClient } from "@/lib/allowed-games"
import type { SteamGame } from "@/lib/steam-api"
import type {
  SteamAchievementsApiResponse,
  SteamGamesApiResponse,
  SteamStatsApiResponse,
} from "@/lib/types/api"
import type { SteamAchievementView, SteamStatsResponse } from "@/lib/types/steam"

export function useSteamAchievementsBatch(appIds: number[]) {
  const [achievementsMap, setAchievementsMap] = useState<Record<number, SteamAchievementView[]>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const appIdsKey = useMemo(() => [...new Set(appIds)].sort((a, b) => a - b).join(","), [appIds])

  useEffect(() => {
    if (!appIds.length) {
      setAchievementsMap({})
      return
    }

    let cancelled = false

    async function fetchBatch() {
      setLoading(true)
      setError(null)
      try {
        const allowedIds = await getAllowedGameIdsClient()
        const filteredAppIds = appIds.filter((id) => allowedIds.has(String(id)))

        const entries = await Promise.all(
          filteredAppIds.map(async (appId): Promise<[number, SteamAchievementView[]]> => {
            try {
              const response = await fetch(`/api/steam/achievements?appId=${appId}`)
              if (!response.ok) {
                return [appId, []]
              }
              const data = (await response.json()) as SteamAchievementsApiResponse
              if (!("achievements" in data) || !Array.isArray(data.achievements)) {
                return [appId, []]
              }
              return [appId, data.achievements]
            } catch {
              return [appId, []]
            }
          }),
        )

        if (!cancelled) {
          setAchievementsMap(Object.fromEntries(entries))
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error")
          setAchievementsMap({})
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void fetchBatch()

    return () => {
      cancelled = true
    }
  }, [appIds, appIdsKey])

  return { achievementsMap, loading, error }
}

export function useSteamGames(type: "recent" | "all" = "recent") {
  const [games, setGames] = useState<SteamGame[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchGames() {
      try {
        setLoading(true)
        setError(null)

        const response = await fetch(`/api/steam/games?type=${type}`)
        if (!response.ok) {
          throw new Error("Failed to fetch games")
        }

        const data = (await response.json()) as SteamGamesApiResponse
        if (!("games" in data) || !Array.isArray(data.games)) {
          throw new Error("Invalid games response")
        }

        const allowedIds = await getAllowedGameIdsClient()
        const filteredGames = data.games.filter((game) => allowedIds.has(String(game.appid)))

        if (!cancelled) {
          setGames(filteredGames)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error")
          setGames([])
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void fetchGames()

    return () => {
      cancelled = true
    }
  }, [type])

  return { games, loading, error }
}

export function useSteamStats() {
  const [stats, setStats] = useState<SteamStatsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchStats() {
      try {
        setLoading(true)
        setError(null)
        const response = await fetch("/api/steam/stats")
        if (!response.ok) {
          throw new Error("Failed to fetch stats")
        }

        const data = (await response.json()) as SteamStatsApiResponse
        if (!("totalGames" in data)) {
          throw new Error("Invalid stats response")
        }

        if (!cancelled) {
          setStats(data)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error")
          setStats(null)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void fetchStats()

    return () => {
      cancelled = true
    }
  }, [])

  return { stats, loading, error }
}

export function useSteamAchievements(appId: number | null) {
  const [achievements, setAchievements] = useState<SteamAchievementView[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!appId) {
      setAchievements([])
      return
    }

    let cancelled = false

    async function fetchAchievements() {
      try {
        setLoading(true)
        setError(null)

        const allowedIds = await getAllowedGameIdsClient()
        if (!allowedIds.has(String(appId))) {
          if (!cancelled) {
            setAchievements([])
          }
          return
        }

        const response = await fetch(`/api/steam/achievements?appId=${appId}`)
        if (!response.ok) {
          throw new Error("Failed to fetch achievements")
        }

        const data = (await response.json()) as SteamAchievementsApiResponse
        if (!("achievements" in data) || !Array.isArray(data.achievements)) {
          throw new Error("Invalid achievements response")
        }

        if (!cancelled) {
          setAchievements(data.achievements)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error")
          setAchievements([])
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void fetchAchievements()

    return () => {
      cancelled = true
    }
  }, [appId])

  return { achievements, loading, error }
}
