"use client"

import { useState, useMemo, useCallback, useEffect, useRef } from "react"
import { Trophy, PieChart, ArrowUpDown, Play, Search } from "lucide-react"

import { GameCard } from "@/components/ui/game-card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { SurfaceCard } from "@/components/ui/surface-card"
import { useSteamAchievementsBatch, useSteamGames } from "@/hooks/use-steam-data"
import { getSteamHeaderImageUrl } from "@/lib/steam-api"
import { buildGamesWithStats, mapOwnedGamesToGameCards, sortGames } from "@/lib/games-mapping"
import type { SteamGameCardModel } from "@/lib/types/steam"

type GamesOrder = "completed" | "alphabetical" | "achievementsAsc" | "achievementsDesc"
type GamesState = "all" | "started" | "perfect" | "notstarted"
type PlayedFilter = "all" | "played" | "notplayed"
type AchievementScope = "with" | "without" | "all"

const VALID_ORDERS: GamesOrder[] = ["completed", "alphabetical", "achievementsAsc", "achievementsDesc"]
const VALID_STATES: GamesState[] = ["all", "started", "perfect", "notstarted"]

const STATE_OPTIONS: { value: GamesState; label: string }[] = [
  { value: "all", label: "All states" },
  { value: "started", label: "In Progress" },
  { value: "perfect", label: "Perfect" },
  { value: "notstarted", label: "Not Started" },
]

const PLAYED_OPTIONS: { value: PlayedFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "played", label: "Played" },
  { value: "notplayed", label: "Not Played" },
]

const ACHIEVEMENT_OPTIONS: { value: AchievementScope; label: string }[] = [
  { value: "all", label: "All games" },
  { value: "with", label: "With achievements" },
  { value: "without", label: "Without achievements" },
]

const ORDER_OPTIONS: { value: GamesOrder; label: string }[] = [
  { value: "completed", label: "Completion %" },
  { value: "alphabetical", label: "A-Z" },
  { value: "achievementsDesc", label: "Most achievements" },
  { value: "achievementsAsc", label: "Fewest achievements" },
]

const VALID_ACHIEVEMENT_SCOPES: AchievementScope[] = ["with", "without", "all"]

const VALID_PLAYED: PlayedFilter[] = ["all", "played", "notplayed"]

interface LibraryOverviewProps {
  initialFilter?: string | null
  initialOrder?: string | null
  initialAchievements?: string | null
  initialPlayed?: string | null
}

export function LibraryOverview({
  initialFilter,
  initialOrder,
  initialAchievements,
  initialPlayed,
}: LibraryOverviewProps = {}) {
  const { games: ownedGames, loading, error } = useSteamGames("all")

  const parsedState = VALID_STATES.includes(initialFilter as GamesState) ? (initialFilter as GamesState) : "all"
  const parsedOrder = VALID_ORDERS.includes(initialOrder as GamesOrder) ? (initialOrder as GamesOrder) : "completed"
  const parsedAchievements = VALID_ACHIEVEMENT_SCOPES.includes(initialAchievements as AchievementScope)
    ? (initialAchievements as AchievementScope)
    : "all"

  const parsedPlayed = VALID_PLAYED.includes(initialPlayed as PlayedFilter) ? (initialPlayed as PlayedFilter) : "all"

  const [state, setState] = useState<GamesState>(parsedState)
  const [playedFilter, setPlayedFilter] = useState<PlayedFilter>(parsedPlayed)
  const [achievementScope, setAchievementScope] = useState<AchievementScope>(parsedAchievements)
  const [order, setOrder] = useState<GamesOrder>(parsedOrder)
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(null)
  const [locallyHidden, setLocallyHidden] = useState<Set<number>>(new Set())

  const handleHideGame = useCallback(async (appId: number) => {
    try {
      const res = await fetch("/api/steam/games/hide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId }),
      })
      if (res.ok) {
        setLocallyHidden((prev) => new Set([...prev, appId]))
      }
    } catch {
      // ignore
    }
  }, [])

  const games = useMemo(
    () => mapOwnedGamesToGameCards(ownedGames, (appid) => getSteamHeaderImageUrl(appid)),
    [ownedGames],
  )
  const appIds = useMemo(() => games.map((game) => game.id), [games])
  const { achievementsMap, loading: achievementsLoading } = useSteamAchievementsBatch(appIds)

  const gamesWithStats = useMemo(
    () => sortGames(buildGamesWithStats(games, achievementsMap), order),
    [games, achievementsMap, order],
  )

  const visibleGames = useMemo(() => {
    let filtered = gamesWithStats

    if (achievementScope === "with") {
      filtered = filtered.filter((game) => game.totalAchievements > 0)
    } else if (achievementScope === "without") {
      filtered = filtered.filter((game) => game.totalAchievements === 0)
    }

    switch (state) {
      case "started":
        filtered = filtered.filter((game) => game.totalAchievements > 0 && game.percent > 0 && !game.completed)
        break
      case "perfect":
        filtered = filtered.filter((game) => game.completed)
        break
      case "notstarted":
        filtered = filtered.filter((game) => game.totalAchievements > 0 && game.percent === 0)
        break
    }

    // Played filter: a game counts as "played" if Steam reports any playtime
    // OR if at least one achievement has been unlocked. The second clause is
    // necessary for delisted/pinned games (FaceRig, Free to Play, …) where
    // GetPlayerAchievements still honours unlocks but there's no playtime.
    if (playedFilter === "played") {
      filtered = filtered.filter((game) => game.playtime > 0 || game.unlockedAchievements > 0)
    } else if (playedFilter === "notplayed") {
      filtered = filtered.filter((game) => game.playtime === 0 && game.unlockedAchievements === 0)
    }

    // Hide locally hidden games
    filtered = filtered.filter((game) => !locallyHidden.has(game.id))

    // Search by name
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      filtered = filtered.filter((game) => game.name.toLowerCase().includes(q))
    }

    return filtered
  }, [gamesWithStats, state, achievementScope, playedFilter, locallyHidden, search])

  const PAGE_SIZE = 30
  const [page, setPage] = useState(0)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const resetPage = useCallback(() => setPage(0), [])

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setPage((prev) => prev + 1)
        }
      },
      { rootMargin: "400px" },
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [visibleGames.length])

  const displayCount = (page + 1) * PAGE_SIZE
  const displayedGames = useMemo(() => visibleGames.slice(0, displayCount), [visibleGames, displayCount])
  const hasMore = displayCount < visibleGames.length

  const listLoading = loading || achievementsLoading
  const totalCount = gamesWithStats.length
  const filteredCount = visibleGames.length

  const showCompletionFilter = playedFilter !== "notplayed"
  const showAchievementFilter = state === "all" || playedFilter === "notplayed"

  const handlePlayedChange = (value: string) => {
    const newPlayed = value as PlayedFilter
    setPlayedFilter(newPlayed)
    if (newPlayed === "notplayed") {
      setState("all")
    }
    resetPage()
  }

  const handleStateChange = (value: string) => {
    const newState = value as GamesState
    setState(newState)
    if (newState !== "all") {
      setAchievementScope("all")
    }
    resetPage()
  }

  const handleAchievementChange = (value: string) => {
    setAchievementScope(value as AchievementScope)
    resetPage()
  }

  const handleOrderChange = (value: string) => {
    setOrder(value as GamesOrder)
    resetPage()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-36 space-y-1.5">
            <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
              <Play className="h-3 w-3" />
              Played
            </span>
            <Select value={playedFilter} onValueChange={handlePlayedChange}>
              <SelectTrigger className="w-full" aria-label="Played filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLAYED_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {showCompletionFilter && (
            <div className="w-full space-y-1.5 sm:w-44">
              <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
                <PieChart className="h-3 w-3" />
                Completion
              </span>
              <Select value={state} onValueChange={handleStateChange}>
                <SelectTrigger className="w-full" aria-label="Completion state filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {showAchievementFilter && (
            <div className="w-full space-y-1.5 sm:w-48">
              <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
                <Trophy className="h-3 w-3" />
                Achievements
              </span>
              <Select value={achievementScope} onValueChange={handleAchievementChange}>
                <SelectTrigger className="w-full" aria-label="Achievement scope filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACHIEVEMENT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="w-48 space-y-1.5">
          <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
            <ArrowUpDown className="h-3 w-3" />
            Sort by
          </span>
          <Select value={order} onValueChange={handleOrderChange}>
            <SelectTrigger className="w-full" aria-label="Sort order">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ORDER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="border-surface-4 bg-surface-1 focus-within:border-accent flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border px-3">
          <Search className="text-muted-foreground h-4 w-4 shrink-0" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => {
              const value = e.target.value
              setSearchInput(value)
              if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
              searchTimerRef.current = setTimeout(() => {
                setSearch(value)
                resetPage()
              }, 300)
            }}
            placeholder="Search games..."
            className="text-foreground placeholder:text-muted-foreground h-full w-full bg-transparent text-sm focus:outline-none"
          />
        </div>
        <p className="text-muted-foreground shrink-0 text-sm">
          {listLoading
            ? "Loading..."
            : filteredCount === totalCount
              ? `${totalCount} games`
              : `${filteredCount} of ${totalCount} games`}
        </p>
      </div>

      <hr className="border-surface-4" />

      {listLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="border-surface-4 bg-surface-1 flex items-stretch gap-4 rounded-lg border px-4 py-4">
              <Skeleton className="h-[5.9rem] w-48 rounded-2xl" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-5 w-44" />
                <div className="flex gap-4">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-24" />
                </div>
                <Skeleton className="h-2 w-full rounded-full" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <p className="text-destructive py-8 text-center">{error}</p>
      ) : visibleGames.length === 0 ? (
        <SurfaceCard variant="empty">
          <p className="text-muted-foreground">No games match the current filters.</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Hit the Sync button in the header to load your Steam data.
          </p>
        </SurfaceCard>
      ) : (
        <div className="space-y-4">
          {displayedGames.map((game: SteamGameCardModel, i: number) => {
            // Cap the entrance stagger to the first 12 cards — beyond that
            // the animation cost on big libraries outweighs the polish.
            const animateEntrance = i < 12
            return (
              <div
                key={game.id}
                className={animateEntrance ? "animate-in fade-in slide-in-from-bottom-2 fill-mode-both" : undefined}
                style={animateEntrance ? { animationDelay: `${i * 25}ms`, animationDuration: "350ms" } : undefined}
              >
                <GameCard
                  id={game.id}
                  name={game.name}
                  image={game.image}
                  playtime={game.playtime}
                  achievements={game.achievements}
                  achievementsLoading={achievementsLoading}
                  href={`/game/${game.id}`}
                  serverTotal={game.totalAchievements}
                  serverUnlocked={game.unlockedAchievements}
                  serverPerfect={game.completed}
                  onHide={handleHideGame}
                />
              </div>
            )
          })}
          {hasMore ? (
            <div ref={sentinelRef} className="h-1" />
          ) : filteredCount > PAGE_SIZE ? (
            <p className="text-muted-foreground py-4 text-center text-sm">Showing all {filteredCount} games</p>
          ) : null}
        </div>
      )}
    </div>
  )
}
