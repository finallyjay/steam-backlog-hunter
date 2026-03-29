"use client"

import { useState, useMemo, useEffect, useCallback } from "react"
import { RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { GameCard } from "@/components/ui/game-card"
import { GamesFilterBar } from "@/components/ui/games-filter-bar"
import { useSteamAchievementsBatch, useSteamGames } from "@/hooks/use-steam-data"
import { getSteamHeaderImageUrl } from "@/lib/steam-api"
import { buildGamesWithStats, filterVisibleGames, mapOwnedGamesToGameCards, sortGames } from "@/lib/games-mapping"
import { getAllowedGameIdsClient } from "@/lib/allowed-games"
import type { SteamGameCardModel } from "@/lib/types/steam"

type GamesOrder = "completed" | "alphabetical" | "achievementsAsc" | "achievementsDesc"

export function LibraryOverview() {
  const {
    games: ownedGames,
    loading,
    isRefreshing: isRefreshingGames,
    lastUpdated: gamesLastUpdated,
    error,
    refetch: refetchGames,
  } = useSteamGames("all")

  const [showCompleted, setShowCompleted] = useState(false)
  const [onlyWithAchievements, setOnlyWithAchievements] = useState(true)
  const [order, setOrder] = useState<GamesOrder>("completed")
  const [trackedIds, setTrackedIds] = useState<Set<string>>(new Set())
  const [trackedIdsLoading, setTrackedIdsLoading] = useState(true)
  const [scope, setScope] = useState<"all" | "tracked">("all")

  const games = useMemo(
    () => mapOwnedGamesToGameCards(ownedGames, (appid) => getSteamHeaderImageUrl(appid)),
    [ownedGames],
  )
  const appIds = useMemo(() => games.map((game) => game.id), [games])
  const {
    achievementsMap,
    loading: achievementsLoading,
    isRefreshing: isRefreshingAchievements,
    refetch: refetchAchievements,
  } = useSteamAchievementsBatch(appIds)

  const updatedLabel = gamesLastUpdated ? `Updated at ${gamesLastUpdated.toLocaleTimeString()}` : "Not updated yet"
  const refreshInProgress = isRefreshingGames || isRefreshingAchievements

  useEffect(() => {
    let isMounted = true

    async function loadTrackedIds() {
      try {
        const ids = await getAllowedGameIdsClient()
        if (isMounted) {
          setTrackedIds(ids)
          setTrackedIdsLoading(false)
        }
      } catch {
        if (isMounted) {
          setTrackedIds(new Set())
          setTrackedIdsLoading(false)
        }
      }
    }

    void loadTrackedIds()
    return () => {
      isMounted = false
    }
  }, [])

  const handleRefresh = useCallback(async () => {
    await Promise.all([refetchGames(), refetchAchievements()])
  }, [refetchAchievements, refetchGames])

  const gamesWithStats = useMemo(
    () => sortGames(buildGamesWithStats(games, achievementsMap), order),
    [games, achievementsMap, order],
  )

  const visibleGames = useMemo(() => {
    let filtered = filterVisibleGames(gamesWithStats, showCompleted)

    if (onlyWithAchievements) {
      filtered = filtered.filter((game) => game.totalAchievements > 0)
    }

    if (scope === "tracked") {
      filtered = filtered.filter((game) => trackedIds.has(String(game.id)))
    }

    return filtered
  }, [gamesWithStats, onlyWithAchievements, scope, showCompleted, trackedIds])

  const filterDataLoading = scope === "tracked" && trackedIdsLoading
  const listLoading = loading || achievementsLoading || filterDataLoading

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <GamesFilterBar
          order={order}
          setOrder={setOrder}
          showCompleted={showCompleted}
          setShowCompleted={setShowCompleted}
          onlyWithAchievements={onlyWithAchievements}
          setOnlyWithAchievements={setOnlyWithAchievements}
        />
        <div className="flex items-center gap-3">
          <div className="bg-card/80 inline-flex gap-1 rounded-[1.2rem] border border-white/10 p-1.5">
            <Button
              variant={scope === "all" ? "default" : "ghost"}
              size="sm"
              onClick={() => setScope("all")}
              className={
                scope === "all"
                  ? "bg-accent hover:bg-accent/90 text-white"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/8"
              }
            >
              All
            </Button>
            <Button
              variant={scope === "tracked" ? "default" : "ghost"}
              size="sm"
              onClick={() => setScope("tracked")}
              className={
                scope === "tracked"
                  ? "bg-accent hover:bg-accent/90 text-white"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/8"
              }
            >
              Tracked
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshInProgress} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${refreshInProgress ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <p className="text-muted-foreground text-xs">{updatedLabel}</p>

      {listLoading ? (
        <p className="text-muted-foreground py-8 text-center">Loading games...</p>
      ) : error ? (
        <p className="text-destructive py-8 text-center">{error}</p>
      ) : visibleGames.length === 0 ? (
        <p className="text-muted-foreground rounded-[1.2rem] border border-white/10 bg-white/4 px-6 py-10 text-center">
          No games match the current filters.
        </p>
      ) : (
        <div className="space-y-4">
          {visibleGames.map((game: SteamGameCardModel) => (
            <GameCard
              key={game.id}
              id={game.id}
              name={game.name}
              image={game.image}
              playtime={game.playtime}
              achievements={game.achievements}
              achievementsLoading={achievementsLoading}
              href={`/game/${game.id}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
