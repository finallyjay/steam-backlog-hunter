"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { SteamGame } from "@/lib/steam-api"
import type { SteamAchievementsApiResponse, SteamGamesApiResponse, SteamStatsApiResponse } from "@/lib/types/api"
import type { SteamAchievementView, SteamStatsResponse } from "@/lib/types/steam"

const REFRESH_COOLDOWN_MS = 3000
const STEAM_DATA_INVALIDATED_EVENT = "steam-data-invalidated"

export function invalidateSteamData() {
  if (typeof window === "undefined") {
    return
  }

  window.dispatchEvent(new CustomEvent(STEAM_DATA_INVALIDATED_EVENT))
}

export function useSteamAchievementsBatch(appIds: number[]) {
  const [achievementsMap, setAchievementsMap] = useState<Record<number, SteamAchievementView[]>>({})
  const [loading, setLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)

  const appIdsKey = useMemo(() => [...new Set(appIds)].sort((a, b) => a - b).join(","), [appIds])
  const normalizedAppIds = useMemo(
    () =>
      appIdsKey
        ? appIdsKey
            .split(",")
            .map((id) => Number(id))
            .filter((id) => Number.isFinite(id))
        : [],
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

        const response = await fetch(`/api/steam/achievements/batch?appIds=${normalizedAppIds.join(",")}`)
        if (!response.ok) {
          throw new Error("Failed to fetch achievements batch")
        }

        const data = (await response.json()) as { achievementsMap: Record<string, SteamAchievementView[]> }
        const mapped: Record<number, SteamAchievementView[]> = {}
        for (const [appId, achievements] of Object.entries(data.achievementsMap)) {
          mapped[Number(appId)] = achievements
        }

        setAchievementsMap(mapped)
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

  useEffect(() => {
    function handleInvalidate() {
      void fetchBatch()
    }

    window.addEventListener(STEAM_DATA_INVALIDATED_EVENT, handleInvalidate)
    return () => {
      window.removeEventListener(STEAM_DATA_INVALIDATED_EVENT, handleInvalidate)
    }
  }, [fetchBatch])

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
        const query = options?.manual ? "&refresh=1" : ""
        const response = await fetch(`/api/steam/games?type=${type}${query}`)
        if (!response.ok) {
          throw new Error("Failed to fetch games")
        }

        const data = (await response.json()) as SteamGamesApiResponse
        if (!("games" in data) || !Array.isArray(data.games)) {
          throw new Error("Invalid games response")
        }

        setGames(data.games)
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

  useEffect(() => {
    function handleInvalidate() {
      void loadGames()
    }

    window.addEventListener(STEAM_DATA_INVALIDATED_EVENT, handleInvalidate)
    return () => {
      window.removeEventListener(STEAM_DATA_INVALIDATED_EVENT, handleInvalidate)
    }
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

  useEffect(() => {
    function handleInvalidate() {
      void loadStats()
    }

    window.addEventListener(STEAM_DATA_INVALIDATED_EVENT, handleInvalidate)
    return () => {
      window.removeEventListener(STEAM_DATA_INVALIDATED_EVENT, handleInvalidate)
    }
  }, [loadStats])

  const refetch = useCallback(
    async (options?: { force?: boolean }) => {
      await loadStats({ force: options?.force, manual: true })
    },
    [loadStats],
  )

  return { stats, loading, isRefreshing, lastUpdated, error, refetch }
}

export type SteamExtraGame = {
  appid: number
  name: string | null
  playtime_forever: number
  rtime_first_played: number | null
  rtime_last_played: number | null
  synced_at: string
}

export function useSteamExtras() {
  const [games, setGames] = useState<SteamExtraGame[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/steam/extras")
      if (!response.ok) throw new Error("Failed to fetch extras")
      const data = (await response.json()) as { games: SteamExtraGame[] }
      setGames(data.games)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
      setGames([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    function handleInvalidate() {
      void load()
    }
    window.addEventListener(STEAM_DATA_INVALIDATED_EVENT, handleInvalidate)
    return () => window.removeEventListener(STEAM_DATA_INVALIDATED_EVENT, handleInvalidate)
  }, [load])

  return { games, loading, error, refetch: load }
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
        const query = options?.manual ? "&refresh=1" : ""
        const response = await fetch(`/api/steam/achievements?appId=${appId}${query}`)
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

  useEffect(() => {
    function handleInvalidate() {
      void loadAchievements()
    }

    window.addEventListener(STEAM_DATA_INVALIDATED_EVENT, handleInvalidate)
    return () => {
      window.removeEventListener(STEAM_DATA_INVALIDATED_EVENT, handleInvalidate)
    }
  }, [loadAchievements])

  const refetch = useCallback(async () => {
    await loadAchievements({ manual: true })
  }, [loadAchievements])

  return { achievements, loading, isRefreshing, lastUpdated, error, refetch }
}
