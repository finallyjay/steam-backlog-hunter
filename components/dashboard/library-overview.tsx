"use client"

import { useState, useMemo } from "react"
import { Filter, ArrowUpDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import { GameCard } from "@/components/ui/game-card"
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select"
import { useSteamAchievementsBatch, useSteamGames } from "@/hooks/use-steam-data"
import { getSteamHeaderImageUrl } from "@/lib/steam-api"
import { buildGamesWithStats, mapOwnedGamesToGameCards, sortGames } from "@/lib/games-mapping"
import type { SteamGameCardModel } from "@/lib/types/steam"

type GamesOrder = "completed" | "alphabetical" | "achievementsAsc" | "achievementsDesc"
type GamesState = "started" | "perfect" | "untouched"

const VALID_ORDERS: GamesOrder[] = ["completed", "alphabetical", "achievementsAsc", "achievementsDesc"]
const VALID_STATES: GamesState[] = ["started", "perfect", "untouched"]

const STATE_OPTIONS: Array<{ id: GamesState; label: string }> = [
  { id: "started", label: "In Progress" },
  { id: "perfect", label: "Perfect" },
  { id: "untouched", label: "Untouched" },
]

interface LibraryOverviewProps {
  initialFilter?: string | null
  initialOrder?: string | null
}

export function LibraryOverview({ initialFilter, initialOrder }: LibraryOverviewProps = {}) {
  const { games: ownedGames, loading, error } = useSteamGames("all")

  // Map legacy "started"/"perfect"/"untouched" filter param to the new split model
  const parsedStates = VALID_STATES.includes(initialFilter as GamesState)
    ? new Set<GamesState>([initialFilter as GamesState])
    : new Set<GamesState>()
  const parsedOrder = VALID_ORDERS.includes(initialOrder as GamesOrder) ? (initialOrder as GamesOrder) : "completed"

  const [activeStates, setActiveStates] = useState<Set<GamesState>>(parsedStates)
  const [hideNoAchievements, setHideNoAchievements] = useState(true)

  const toggleState = (s: GamesState) => {
    setActiveStates((prev) => {
      const next = new Set(prev)
      if (next.has(s)) {
        next.delete(s)
      } else {
        next.add(s)
      }
      return next
    })
  }
  const [order, setOrder] = useState<GamesOrder>(parsedOrder)

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

    // Hide games without achievement support
    if (hideNoAchievements) {
      filtered = filtered.filter((game) => game.totalAchievements > 0)
    }

    // State filter (union of selected states, empty = all)
    if (activeStates.size > 0) {
      filtered = filtered.filter((game) => {
        if (activeStates.has("started") && game.totalAchievements > 0 && game.percent > 0 && !game.completed)
          return true
        if (activeStates.has("perfect") && game.completed) return true
        if (activeStates.has("untouched") && (game.totalAchievements === 0 || game.percent === 0)) return true
        return false
      })
    }

    return filtered
  }, [gamesWithStats, activeStates, hideNoAchievements])

  const listLoading = loading || achievementsLoading

  const totalCount = gamesWithStats.length
  const filteredCount = visibleGames.length
  const hasActiveFilters = activeStates.size > 0 || hideNoAchievements

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="text-muted-foreground h-3.5 w-3.5" />
          <div className="bg-card/80 border-surface-4 flex gap-1 rounded-lg border p-1">
            {STATE_OPTIONS.map((opt) => {
              const active = activeStates.has(opt.id)
              return (
                <Button
                  key={opt.id}
                  variant={active ? "default" : "ghost"}
                  size="sm"
                  onClick={() => toggleState(opt.id)}
                  className={
                    active
                      ? "bg-accent text-accent-foreground hover:bg-accent/90"
                      : "text-muted-foreground hover:text-foreground hover:bg-surface-3"
                  }
                >
                  {opt.label}
                </Button>
              )
            })}
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setHideNoAchievements((v) => !v)}
            className={
              hideNoAchievements
                ? "border-accent/25 bg-accent/10 text-accent border"
                : "text-muted-foreground hover:text-foreground hover:bg-surface-3"
            }
          >
            Has achievements
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-sm">
            {listLoading
              ? "Loading..."
              : hasActiveFilters
                ? `${filteredCount} of ${totalCount} games`
                : `${totalCount} games`}
          </p>
          <div className="flex items-center gap-2">
            <ArrowUpDown className="text-muted-foreground h-3.5 w-3.5" />
            <Select value={order} onValueChange={(v) => setOrder(v as GamesOrder)}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="completed">Completion %</SelectItem>
                <SelectItem value="alphabetical">A-Z</SelectItem>
                <SelectItem value="achievementsDesc">Most achievements</SelectItem>
                <SelectItem value="achievementsAsc">Fewest achievements</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {listLoading ? (
        <p className="text-muted-foreground py-8 text-center">Loading games...</p>
      ) : error ? (
        <p className="text-destructive py-8 text-center">{error}</p>
      ) : visibleGames.length === 0 ? (
        <p className="text-muted-foreground border-surface-4 bg-surface-1 rounded-lg border px-6 py-10 text-center">
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
              serverTotal={game.totalAchievements}
              serverUnlocked={game.unlockedAchievements}
              serverPerfect={game.completed}
            />
          ))}
        </div>
      )}
    </div>
  )
}
