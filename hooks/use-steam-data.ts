"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { SteamGame } from "@/lib/steam-api"
import type { SteamAchievementsApiResponse, SteamGamesApiResponse, SteamStatsApiResponse } from "@/lib/types/api"
import type { SteamAchievementView, SteamStatsResponse } from "@/lib/types/steam"

const REFRESH_COOLDOWN_MS = 3000
const STEAM_DATA_INVALIDATED_EVENT = "steam-data-invalidated"

// Each hook splits its loader in two: a "run" core that performs no setState
// before its fetch settles (safe to call synchronously from effects), and an
// event-driven wrapper that additionally flips the loading/refreshing flags
// (only called from event handlers: manual refetch and the invalidate
// listener). Mount relies on correctly initialized state, and key changes
// (type/appId) reset state during render via React's "adjust state on prop
// change" pattern, so effects never set state synchronously.

export function invalidateSteamData() {
  if (typeof window === "undefined") {
    return
  }

  window.dispatchEvent(new CustomEvent(STEAM_DATA_INVALIDATED_EVENT))
}

export function useSteamAchievementsBatch(appIds: number[]) {
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

  const [achievementsMap, setAchievementsMap] = useState<Record<number, SteamAchievementView[]>>({})
  const [loading, setLoading] = useState(normalizedAppIds.length > 0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)

  const inFlightRef = useRef(false)
  const hasLoadedRef = useRef(false)
  const lastRefreshAtRef = useRef(0)

  // `lastUpdated !== null` doubles as the render-safe "has loaded at least
  // once" signal (refs must not be read during render).
  const [prevAppIdsKey, setPrevAppIdsKey] = useState(appIdsKey)
  if (prevAppIdsKey !== appIdsKey) {
    setPrevAppIdsKey(appIdsKey)
    setError(null)
    if (!normalizedAppIds.length) {
      setAchievementsMap({})
      setLastUpdated(new Date())
      setLoading(false)
      setIsRefreshing(false)
    } else if (lastUpdated !== null) {
      setIsRefreshing(true)
    } else {
      setLoading(true)
    }
  }

  const runFetch = useCallback(
    async (options?: { manual?: boolean }) => {
      if (!normalizedAppIds.length) return
      if (inFlightRef.current) return
      if (options?.manual && Date.now() - lastRefreshAtRef.current < REFRESH_COOLDOWN_MS) return

      inFlightRef.current = true
      let mapped: Record<number, SteamAchievementView[]> | null = null
      let errorMessage: string | null = null
      try {
        const response = await fetch(`/api/steam/achievements/batch?appIds=${normalizedAppIds.join(",")}`)
        if (!response.ok) {
          throw new Error("Failed to fetch achievements batch")
        }

        const data = (await response.json()) as { achievementsMap: Record<string, SteamAchievementView[]> }
        const next: Record<number, SteamAchievementView[]> = {}
        for (const [appId, achievements] of Object.entries(data.achievementsMap)) {
          next[Number(appId)] = achievements
        }
        mapped = next
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : "Unknown error"
      }
      inFlightRef.current = false
      if (mapped) {
        setAchievementsMap(mapped)
        setLastUpdated(new Date())
        hasLoadedRef.current = true
      } else {
        setError(errorMessage)
        setAchievementsMap({})
      }
      setLoading(false)
      setIsRefreshing(false)
      if (options?.manual) {
        lastRefreshAtRef.current = Date.now()
      }
    },
    [normalizedAppIds],
  )

  const fetchBatch = useCallback(
    async (options?: { manual?: boolean }) => {
      if (!normalizedAppIds.length) return
      if (inFlightRef.current) return
      if (options?.manual && Date.now() - lastRefreshAtRef.current < REFRESH_COOLDOWN_MS) return

      if (hasLoadedRef.current) {
        setIsRefreshing(true)
      } else {
        setLoading(true)
      }
      setError(null)
      await runFetch(options)
    },
    [normalizedAppIds, runFetch],
  )

  useEffect(() => {
    void runFetch()
  }, [runFetch, appIdsKey])

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

  const [prevType, setPrevType] = useState(type)
  if (prevType !== type) {
    setPrevType(type)
    setLoading(true)
    setError(null)
  }

  const runLoad = useCallback(
    async (options?: { manual?: boolean }) => {
      if (inFlightRef.current) return
      if (options?.manual && Date.now() - lastRefreshAtRef.current < REFRESH_COOLDOWN_MS) return

      inFlightRef.current = true
      let nextGames: SteamGame[] | null = null
      let errorMessage: string | null = null
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
        nextGames = data.games
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : "Unknown error"
      }
      inFlightRef.current = false
      if (nextGames) {
        setGames(nextGames)
        setLastUpdated(new Date())
        hasLoadedRef.current = true
      } else {
        setError(errorMessage)
        setGames([])
      }
      setLoading(false)
      setIsRefreshing(false)
      if (options?.manual) {
        lastRefreshAtRef.current = Date.now()
      }
    },
    [type],
  )

  const loadGames = useCallback(
    async (options?: { manual?: boolean }) => {
      if (inFlightRef.current) return
      if (options?.manual && Date.now() - lastRefreshAtRef.current < REFRESH_COOLDOWN_MS) return

      if (hasLoadedRef.current) {
        setIsRefreshing(true)
      } else {
        setLoading(true)
      }
      setError(null)
      await runLoad(options)
    },
    [runLoad],
  )

  useEffect(() => {
    hasLoadedRef.current = false
    void runLoad()
  }, [runLoad])

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

  const runLoad = useCallback(async (options?: { force?: boolean; manual?: boolean }) => {
    if (inFlightRef.current) return
    if (options?.manual && Date.now() - lastRefreshAtRef.current < REFRESH_COOLDOWN_MS) return

    inFlightRef.current = true
    let nextStats: SteamStatsResponse | null = null
    let errorMessage: string | null = null
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
      nextStats = data
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : "Unknown error"
    }
    inFlightRef.current = false
    if (nextStats) {
      setStats(nextStats)
      setLastUpdated(new Date())
      hasLoadedRef.current = true
    } else {
      setError(errorMessage)
      setStats(null)
    }
    setLoading(false)
    setIsRefreshing(false)
    if (options?.manual) {
      lastRefreshAtRef.current = Date.now()
    }
  }, [])

  const loadStats = useCallback(
    async (options?: { force?: boolean; manual?: boolean }) => {
      if (inFlightRef.current) return
      if (options?.manual && Date.now() - lastRefreshAtRef.current < REFRESH_COOLDOWN_MS) return

      if (hasLoadedRef.current) {
        setIsRefreshing(true)
      } else {
        setLoading(true)
      }
      setError(null)
      await runLoad(options)
    },
    [runLoad],
  )

  useEffect(() => {
    void runLoad()
  }, [runLoad])

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
  image_landscape_url: string | null
  image_portrait_url: string | null
  image_icon_url: string | null
  playtime_forever: number
  rtime_first_played: number | null
  rtime_last_played: number | null
  unlocked_count: number | null
  total_count: number | null
  perfect_game: number
  achievements_synced_at: string | null
  synced_at: string
}

export function useSteamExtras() {
  const [games, setGames] = useState<SteamExtraGame[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const runLoad = useCallback(async () => {
    let nextGames: SteamExtraGame[] | null = null
    let errorMessage: string | null = null
    try {
      const response = await fetch("/api/steam/extras")
      if (!response.ok) throw new Error("Failed to fetch extras")
      const data = (await response.json()) as { games: SteamExtraGame[] }
      nextGames = data.games
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : "Unknown error"
    }
    if (nextGames) {
      setGames(nextGames)
    } else {
      setError(errorMessage)
      setGames([])
    }
    setLoading(false)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    await runLoad()
  }, [runLoad])

  useEffect(() => {
    async function run() {
      await runLoad()
    }
    void run()
  }, [runLoad])

  useEffect(() => {
    function handleInvalidate() {
      void load()
    }
    window.addEventListener(STEAM_DATA_INVALIDATED_EVENT, handleInvalidate)
    return () => window.removeEventListener(STEAM_DATA_INVALIDATED_EVENT, handleInvalidate)
  }, [load])

  return { games, loading, error, refetch: load }
}

export type SteamHiddenGame = {
  appid: number
  name: string | null
  image_landscape_url: string | null
  image_portrait_url: string | null
  image_icon_url: string | null
  playtime_forever: number | null
  hidden_at: string
  source: "library" | "extras"
}

export function useSteamHiddenGames() {
  const [games, setGames] = useState<SteamHiddenGame[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const runLoad = useCallback(async () => {
    let nextGames: SteamHiddenGame[] | null = null
    let errorMessage: string | null = null
    try {
      const response = await fetch("/api/steam/extras?hidden=1")
      if (!response.ok) throw new Error("Failed to fetch hidden games")
      const data = (await response.json()) as { games: SteamHiddenGame[] }
      nextGames = data.games
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : "Unknown error"
    }
    if (nextGames) {
      setGames(nextGames)
    } else {
      setError(errorMessage)
      setGames([])
    }
    setLoading(false)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    await runLoad()
  }, [runLoad])

  useEffect(() => {
    async function run() {
      await runLoad()
    }
    void run()
  }, [runLoad])

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
  const [loading, setLoading] = useState(appId !== null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)

  const inFlightRef = useRef(false)
  const hasLoadedRef = useRef(false)
  const lastRefreshAtRef = useRef(0)

  const [prevAppId, setPrevAppId] = useState(appId)
  if (prevAppId !== appId) {
    setPrevAppId(appId)
    setError(null)
    if (appId) {
      setLoading(true)
    } else {
      setAchievements([])
      setLastUpdated(null)
      setLoading(false)
      setIsRefreshing(false)
    }
  }

  const runLoad = useCallback(
    async (options?: { manual?: boolean }) => {
      if (!appId) return
      if (inFlightRef.current) return
      if (options?.manual && Date.now() - lastRefreshAtRef.current < REFRESH_COOLDOWN_MS) return

      inFlightRef.current = true
      let nextAchievements: SteamAchievementView[] | null = null
      let errorMessage: string | null = null
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
        nextAchievements = data.achievements
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : "Unknown error"
      }
      inFlightRef.current = false
      if (nextAchievements) {
        setAchievements(nextAchievements)
        setLastUpdated(new Date())
        hasLoadedRef.current = true
      } else {
        setError(errorMessage)
        setAchievements([])
      }
      setLoading(false)
      setIsRefreshing(false)
      if (options?.manual) {
        lastRefreshAtRef.current = Date.now()
      }
    },
    [appId],
  )

  const loadAchievements = useCallback(
    async (options?: { manual?: boolean }) => {
      if (!appId) return
      if (inFlightRef.current) return
      if (options?.manual && Date.now() - lastRefreshAtRef.current < REFRESH_COOLDOWN_MS) return

      if (hasLoadedRef.current) {
        setIsRefreshing(true)
      } else {
        setLoading(true)
      }
      setError(null)
      await runLoad(options)
    },
    [appId, runLoad],
  )

  useEffect(() => {
    hasLoadedRef.current = false
    void runLoad()
  }, [runLoad])

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
