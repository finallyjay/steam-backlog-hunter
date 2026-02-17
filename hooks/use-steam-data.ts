"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { getAllowedGameIdsClient } from "@/lib/allowed-games"
import type { SteamGame } from "@/lib/steam-api"
import type {
  SteamAchievementsApiResponse,
  SteamGamesApiResponse,
  SteamStatsApiResponse,
} from "@/lib/types/api"
import type { SteamAchievementView, SteamStatsResponse } from "@/lib/types/steam"

const REFRESH_COOLDOWN_MS = 3000

export function useSteamAchievementsBatch(appIds: number[]) {
  const [achievementsMap, setAchievementsMap] = useState<Record<number, SteamAchievementView[]>>({})
  const [loading, setLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)

  const appIdsKey = useMemo(() => [...new Set(appIds)].sort((a, b) => a - b).join(","), [appIds])
  const normalizedAppIds = useMemo(
    () => (appIdsKey ? appIdsKey.split(",").map((id) => Number(id)).filter((id) => Number.isFinite(id)) : []),
    [appIdsKey],
  )
  const inFlightRef = useRef(false)
  const hasLoadedRef = useRef(false)
  const lastRefreshAtRef = useRef(0)

  const fetchBatch = useCallback(
    async (options?: { manual?: boolean }) => {
      if (inFlightRef.current) return
      if (options?.manual && Date.now() - lastRefreshAtRef.current < REFRESH_COOLDOWN_MS) return

      inFlightRef.current = true
      if (hasLoadedRef.current) {
        setIsRefreshing(true)
      } else {
        setLoading(true)
      }
      setError(null)

      try {
        if (!normalizedAppIds.length) {
          setAchievementsMap({})
          setLastUpdated(new Date())
          hasLoadedRef.current = true
          return
        }

        const allowedIds = await getAllowedGameIdsClient()
        const filteredAppIds = normalizedAppIds.filter((id) => allowedIds.has(String(id)))

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

        setAchievementsMap(Object.fromEntries(entries))
        setLastUpdated(new Date())
        hasLoadedRef.current = true
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error")
        setAchievementsMap({})
      } finally {
        inFlightRef.current = false
        setLoading(false)
        setIsRefreshing(false)
        if (options?.manual) {
          lastRefreshAtRef.current = Date.now()
        }
      }
    },
    [normalizedAppIds],
  )

  useEffect(() => {
    void fetchBatch()
  }, [fetchBatch, appIdsKey])

  const refetch = useCallback(async () => {
    await fetchBatch({ manual: true })
  }, [fetchBatch])

  return { achievementsMap, loading, isRefreshing, lastUpdated, error, refetch }
}

export function useSteamGames(type: "recent" | "all" = "recent") {
  const [games, setGames] = useState<SteamGame[]>([])
  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)

  const inFlightRef = useRef(false)
  const hasLoadedRef = useRef(false)
  const lastRefreshAtRef = useRef(0)

  const loadGames = useCallback(
    async (options?: { manual?: boolean }) => {
      if (inFlightRef.current) return
      if (options?.manual && Date.now() - lastRefreshAtRef.current < REFRESH_COOLDOWN_MS) return

      inFlightRef.current = true
      if (hasLoadedRef.current) {
        setIsRefreshing(true)
      } else {
        setLoading(true)
      }
      setError(null)

      try {
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

        setGames(filteredGames)
        setLastUpdated(new Date())
        hasLoadedRef.current = true
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error")
        setGames([])
      } finally {
        inFlightRef.current = false
        setLoading(false)
        setIsRefreshing(false)
        if (options?.manual) {
          lastRefreshAtRef.current = Date.now()
        }
      }
    },
    [type],
  )

  useEffect(() => {
    hasLoadedRef.current = false
    setLoading(true)
    void loadGames()
  }, [loadGames])

  const refetch = useCallback(async () => {
    await loadGames({ manual: true })
  }, [loadGames])

  return { games, loading, isRefreshing, lastUpdated, error, refetch }
}

export function useSteamStats() {
  const [stats, setStats] = useState<SteamStatsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)

  const inFlightRef = useRef(false)
  const hasLoadedRef = useRef(false)
  const lastRefreshAtRef = useRef(0)

  const loadStats = useCallback(async (options?: { force?: boolean; manual?: boolean }) => {
    if (inFlightRef.current) return
    if (options?.manual && Date.now() - lastRefreshAtRef.current < REFRESH_COOLDOWN_MS) return

    inFlightRef.current = true
    if (hasLoadedRef.current) {
      setIsRefreshing(true)
    } else {
      setLoading(true)
    }
    setError(null)

    try {
      const query = options?.force ? "?refresh=1" : ""
      const response = await fetch(`/api/steam/stats${query}`)
      if (!response.ok) {
        throw new Error("Failed to fetch stats")
      }

      const data = (await response.json()) as SteamStatsApiResponse
      if (!("totalGames" in data)) {
        throw new Error("Invalid stats response")
      }

      setStats(data)
      setLastUpdated(new Date())
      hasLoadedRef.current = true
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
      setStats(null)
    } finally {
      inFlightRef.current = false
      setLoading(false)
      setIsRefreshing(false)
      if (options?.manual) {
        lastRefreshAtRef.current = Date.now()
      }
    }
  }, [])

  useEffect(() => {
    void loadStats()
  }, [loadStats])

  const refetch = useCallback(
    async (options?: { force?: boolean }) => {
      await loadStats({ force: options?.force, manual: true })
    },
    [loadStats],
  )

  return { stats, loading, isRefreshing, lastUpdated, error, refetch }
}

export function useSteamAchievements(appId: number | null) {
  const [achievements, setAchievements] = useState<SteamAchievementView[]>([])
  const [loading, setLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)

  const inFlightRef = useRef(false)
  const hasLoadedRef = useRef(false)
  const lastRefreshAtRef = useRef(0)

  const loadAchievements = useCallback(
    async (options?: { manual?: boolean }) => {
      if (!appId) {
        setAchievements([])
        setLastUpdated(null)
        hasLoadedRef.current = false
        setLoading(false)
        setIsRefreshing(false)
        return
      }
      if (inFlightRef.current) return
      if (options?.manual && Date.now() - lastRefreshAtRef.current < REFRESH_COOLDOWN_MS) return

      inFlightRef.current = true
      if (hasLoadedRef.current) {
        setIsRefreshing(true)
      } else {
        setLoading(true)
      }
      setError(null)

      try {
        const allowedIds = await getAllowedGameIdsClient()
        if (!allowedIds.has(String(appId))) {
          setAchievements([])
          setLastUpdated(new Date())
          hasLoadedRef.current = true
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

        setAchievements(data.achievements)
        setLastUpdated(new Date())
        hasLoadedRef.current = true
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error")
        setAchievements([])
      } finally {
        inFlightRef.current = false
        setLoading(false)
        setIsRefreshing(false)
        if (options?.manual) {
          lastRefreshAtRef.current = Date.now()
        }
      }
    },
    [appId],
  )

  useEffect(() => {
    hasLoadedRef.current = false
    setLoading(appId !== null)
    void loadAchievements()
  }, [appId, loadAchievements])

  const refetch = useCallback(async () => {
    await loadAchievements({ manual: true })
  }, [loadAchievements])

  return { achievements, loading, isRefreshing, lastUpdated, error, refetch }
}
