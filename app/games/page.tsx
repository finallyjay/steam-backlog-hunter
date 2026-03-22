
"use client"
import { UserProfile } from "@/components/dashboard/user-profile"
import { usePageTitle } from "@/components/ui/page-title-context"
import { useCurrentUser } from "@/hooks/use-current-user"
import { useEffect, useState, useMemo, useCallback } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { getSteamHeaderImageUrl } from "@/lib/steam-api"
import { GameCard } from "@/components/ui/game-card"
import { useSteamAchievementsBatch, useSteamGames, useSteamStats } from "@/hooks/use-steam-data"
import { GamesFilterBar } from "@/components/ui/games-filter-bar"
import { PageContainer } from "@/components/ui/page-container"
import { LoadingMessage } from "@/components/ui/loading-message"
import { ErrorMessage } from "@/components/ui/error-message"
import { buildGamesWithStats, filterVisibleGames, mapOwnedGamesToGameCards, sortGames } from "@/lib/games-mapping"
import { getAllowedGameIdsClient } from "@/lib/allowed-games"
import type { SteamGameCardModel } from "@/lib/types/steam"
import { Button } from "@/components/ui/button"
import { RefreshCw } from "lucide-react"

type GamesOrder = "completed" | "alphabetical" | "achievementsAsc" | "achievementsDesc"

export default function GamesPage() {
  const searchParams = useSearchParams()
  const { setTitle } = usePageTitle()
  useEffect(() => {
    setTitle("Games")
    return () => setTitle("")
  }, [setTitle])
  const { user, loading: loadingUser } = useCurrentUser()
  const {
    games: ownedGames,
    loading,
    isRefreshing: isRefreshingGames,
    lastUpdated: gamesLastUpdated,
    error,
    refetch: refetchGames,
  } = useSteamGames("all")
  const {
    stats,
    loading: statsLoading,
    isRefreshing: isRefreshingStats,
    lastUpdated: statsLastUpdated,
    refetch: refetchStats,
  } = useSteamStats()

  const [showCompleted, setShowCompleted] = useState(false)
  const [order, setOrder] = useState<GamesOrder>("completed")
  const [trackedIds, setTrackedIds] = useState<Set<string>>(new Set())
  const [trackedIdsLoading, setTrackedIdsLoading] = useState(true)

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
  const updatedAt = statsLastUpdated ?? gamesLastUpdated
  const updatedLabel = updatedAt ? `Updated at ${updatedAt.toLocaleTimeString()}` : "Not updated yet"
  const refreshInProgress = isRefreshingGames || isRefreshingStats || isRefreshingAchievements
  const scope = searchParams.get("scope") === "tracked" ? "tracked" : "all"
  const bucket = searchParams.get("bucket")
  const state = searchParams.get("state")

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
    await Promise.all([refetchGames(), refetchStats({ force: true }), refetchAchievements()])
  }, [refetchAchievements, refetchGames, refetchStats])

  // Calculate % achievements and completion status
  const gamesWithStats = useMemo(
    () => sortGames(buildGamesWithStats(games, achievementsMap), order),
    [games, achievementsMap, order],
  )

  const visibleGames = useMemo(() => {
    let filtered = filterVisibleGames(gamesWithStats, showCompleted)

    if (scope === "tracked") {
      filtered = filtered.filter((game) => trackedIds.has(String(game.id)))
    }

    if (state === "played") {
      filtered = filtered.filter((game) => game.playtime > 0)
    } else if (state === "unplayed") {
      filtered = filtered.filter((game) => game.playtime === 0)
    }

    if (bucket === "perfect") {
      filtered = filtered.filter((game) => game.totalAchievements > 0 && game.completed)
    } else if (bucket === "started") {
      filtered = filtered.filter((game) => {
        const unlocked = game.achievements.filter((achievement) => achievement.achieved === 1).length
        return game.totalAchievements > 0 && unlocked > 0 && !game.completed
      })
    } else if (bucket === "untouched") {
      filtered = filtered.filter((game) => {
        const unlocked = game.achievements.filter((achievement) => achievement.achieved === 1).length
        return game.totalAchievements > 0 && unlocked === 0
      })
    }

    return filtered
  }, [bucket, gamesWithStats, scope, showCompleted, state, trackedIds])
  const bucketFilterActive = bucket === "perfect" || bucket === "started" || bucket === "untouched"
  const filterDataLoading = (scope === "tracked" && trackedIdsLoading) || (bucketFilterActive && achievementsLoading)
  const listLoading = loading || achievementsLoading || filterDataLoading
  const statsUpdatedLabel = statsLoading ? "Refreshing stats..." : updatedLabel

  if (loadingUser) {
    return <LoadingMessage />
  }

  if (!user) {
    return <ErrorMessage />
  }

  return (
    <PageContainer>
      <div className="grid gap-8">
        <UserProfile user={user} stats={stats} statsLoading={statsLoading} statsUpdatedLabel={statsUpdatedLabel} />
        <div className="space-y-2">
          <GamesFilterBar order={order} setOrder={setOrder} showCompleted={showCompleted} setShowCompleted={setShowCompleted} />
          {(scope !== "all" || bucket || state) ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>Filtered view:</span>
              {scope === "tracked" ? <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">Tracked games</span> : null}
              {bucket ? <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 capitalize">{bucket}</span> : null}
              {state ? <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 capitalize">{state}</span> : null}
              <Link href="/games" className="text-accent hover:text-accent/80">Clear filters</Link>
            </div>
          ) : null}
          <div className="flex items-center justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshInProgress}
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${refreshInProgress ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {updatedLabel}
          </p>
        </div>
        {listLoading ? (
          <p className="text-center text-muted-foreground">Loading games...</p>
        ) : error ? (
          <p className="text-center text-destructive">{error}</p>
        ) : visibleGames.length === 0 ? (
          <p className="rounded-[1.2rem] border border-white/10 bg-white/4 px-6 py-10 text-center text-muted-foreground">
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
    </PageContainer>
  )
}
