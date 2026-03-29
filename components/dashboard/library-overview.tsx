"use client"

import { useState, useMemo } from "react"
import { Trophy, PieChart, ArrowUpDown, Play } from "lucide-react"
import Select from "react-select"

import { GameCard } from "@/components/ui/game-card"
import { useSteamAchievementsBatch, useSteamGames } from "@/hooks/use-steam-data"
import { getSteamHeaderImageUrl } from "@/lib/steam-api"
import { buildGamesWithStats, mapOwnedGamesToGameCards, sortGames } from "@/lib/games-mapping"
import type { SteamGameCardModel } from "@/lib/types/steam"

type GamesOrder = "completed" | "alphabetical" | "achievementsAsc" | "achievementsDesc"
type GamesState = "all" | "started" | "perfect" | "notstarted"
type PlayedFilter = "all" | "played" | "notplayed"
type AchievementScope = "with" | "without" | "all"

type Option = { value: string; label: string }

const VALID_ORDERS: GamesOrder[] = ["completed", "alphabetical", "achievementsAsc", "achievementsDesc"]
const VALID_STATES: GamesState[] = ["all", "started", "perfect", "notstarted"]

const STATE_OPTIONS: Option[] = [
  { value: "started", label: "In Progress" },
  { value: "perfect", label: "Perfect" },
  { value: "notstarted", label: "Not Started" },
]

const PLAYED_OPTIONS: Option[] = [
  { value: "played", label: "Played" },
  { value: "notplayed", label: "Not Played" },
]

const ACHIEVEMENT_OPTIONS: Option[] = [
  { value: "with", label: "With achievements" },
  { value: "without", label: "Without achievements" },
]

const ORDER_OPTIONS: Option[] = [
  { value: "completed", label: "Completion %" },
  { value: "alphabetical", label: "A-Z" },
  { value: "achievementsDesc", label: "Most achievements" },
  { value: "achievementsAsc", label: "Fewest achievements" },
]

const selectStyles = {
  control: (base: Record<string, unknown>, state: { isFocused: boolean }) => ({
    ...base,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: state.isFocused ? "var(--color-accent)" : "rgba(255,255,255,0.1)",
    borderRadius: "0.5rem",
    minHeight: "2rem",
    fontSize: "0.875rem",
    boxShadow: "none",
    cursor: "pointer",
    "&:hover": { borderColor: "rgba(255,255,255,0.2)" },
  }),
  menu: (base: Record<string, unknown>) => ({
    ...base,
    backgroundColor: "var(--color-popover)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "0.5rem",
    zIndex: 50,
  }),
  option: (base: Record<string, unknown>, state: { isSelected: boolean; isFocused: boolean }) => ({
    ...base,
    backgroundColor: state.isSelected
      ? "var(--color-accent)"
      : state.isFocused
        ? "rgba(255,255,255,0.08)"
        : "transparent",
    color: state.isSelected ? "var(--color-accent-foreground)" : "var(--color-foreground)",
    fontSize: "0.875rem",
    cursor: "pointer",
    borderRadius: "0.375rem",
    margin: "2px 4px",
    width: "calc(100% - 8px)",
    "&:active": { backgroundColor: "rgba(255,255,255,0.12)" },
  }),
  singleValue: (base: Record<string, unknown>) => ({
    ...base,
    color: "var(--color-foreground)",
  }),
  placeholder: (base: Record<string, unknown>) => ({
    ...base,
    color: "var(--color-muted-foreground)",
  }),
  indicatorSeparator: () => ({ display: "none" }),
  dropdownIndicator: (base: Record<string, unknown>) => ({
    ...base,
    color: "var(--color-muted-foreground)",
    padding: "0 6px",
    "&:hover": { color: "var(--color-foreground)" },
  }),
  clearIndicator: (base: Record<string, unknown>) => ({
    ...base,
    color: "var(--color-muted-foreground)",
    padding: "0 4px",
    cursor: "pointer",
    "&:hover": { color: "var(--color-foreground)" },
  }),
  input: (base: Record<string, unknown>) => ({
    ...base,
    color: "var(--color-foreground)",
  }),
}

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

    // Played filter
    if (playedFilter === "played") {
      filtered = filtered.filter((game) => game.playtime > 0)
    } else if (playedFilter === "notplayed") {
      filtered = filtered.filter((game) => game.playtime === 0)
    }

    return filtered
  }, [gamesWithStats, state, achievementScope, playedFilter])

  const listLoading = loading || achievementsLoading
  const totalCount = gamesWithStats.length
  const filteredCount = visibleGames.length

  const selectedState = state === "all" ? null : (STATE_OPTIONS.find((o) => o.value === state) ?? null)
  const selectedPlayed = playedFilter === "all" ? null : (PLAYED_OPTIONS.find((o) => o.value === playedFilter) ?? null)
  const selectedAchievement = ACHIEVEMENT_OPTIONS.find((o) => o.value === achievementScope) ?? ACHIEVEMENT_OPTIONS[0]
  const selectedOrder = ORDER_OPTIONS.find((o) => o.value === order) ?? ORDER_OPTIONS[0]
  const showCompletionFilter = playedFilter !== "notplayed"
  const showAchievementFilter = state === "all" || playedFilter === "notplayed"

  const handlePlayedChange = (opt: Option | null) => {
    const newPlayed = opt ? (opt.value as PlayedFilter) : "all"
    setPlayedFilter(newPlayed)
    if (newPlayed === "notplayed") {
      setState("all")
    }
  }

  const handleStateChange = (opt: Option | null) => {
    const newState = opt ? (opt.value as GamesState) : "all"
    setState(newState)
    if (newState !== "all") {
      setAchievementScope("all")
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-36 space-y-1.5">
            <label className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
              <Play className="h-3 w-3" />
              Played
            </label>
            <Select
              value={selectedPlayed}
              onChange={handlePlayedChange}
              options={PLAYED_OPTIONS}
              isClearable
              isSearchable={false}
              placeholder="All"
              styles={selectStyles}
              menuPlacement="auto"
            />
          </div>

          {showCompletionFilter && (
            <div className="w-44 space-y-1.5">
              <label className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
                <PieChart className="h-3 w-3" />
                Completion
              </label>
              <Select
                value={selectedState}
                onChange={handleStateChange}
                options={STATE_OPTIONS}
                isClearable
                isSearchable={false}
                placeholder="All states"
                styles={selectStyles}
                menuPlacement="auto"
              />
            </div>
          )}

          {showAchievementFilter && (
            <div className="w-48 space-y-1.5">
              <label className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
                <Trophy className="h-3 w-3" />
                Achievements
              </label>
              <Select
                value={achievementScope === "all" ? null : selectedAchievement}
                onChange={(opt) => setAchievementScope(opt ? (opt.value as AchievementScope) : "all")}
                options={ACHIEVEMENT_OPTIONS}
                isClearable
                isSearchable={false}
                placeholder="All games"
                styles={selectStyles}
                menuPlacement="auto"
              />
            </div>
          )}
        </div>

        <div className="w-48 space-y-1.5">
          <label className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
            <ArrowUpDown className="h-3 w-3" />
            Sort by
          </label>
          <Select
            value={selectedOrder}
            onChange={(opt) => setOrder(opt ? (opt.value as GamesOrder) : "completed")}
            options={ORDER_OPTIONS}
            isSearchable={false}
            styles={selectStyles}
            menuPlacement="auto"
          />
        </div>
      </div>

      <p className="text-muted-foreground text-sm">
        {listLoading ? "Loading..." : `${filteredCount} of ${totalCount} games`}
      </p>

      {listLoading ? (
        <p className="text-muted-foreground py-8 text-center">Loading games...</p>
      ) : error ? (
        <p className="text-destructive py-8 text-center">{error}</p>
      ) : visibleGames.length === 0 ? (
        <div className="border-surface-4 bg-surface-1 rounded-lg border px-6 py-10 text-center">
          <p className="text-muted-foreground">No games match the current filters.</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Hit the Sync button in the header to load your Steam data.
          </p>
        </div>
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
