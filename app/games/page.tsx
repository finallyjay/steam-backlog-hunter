
"use client"
import { UserProfile } from "@/components/dashboard/user-profile"
import { usePageTitle } from "@/components/ui/page-title-context"
import { useCurrentUser } from "@/hooks/use-current-user"
import { useEffect, useState, useMemo } from "react"
import { getSteamImageUrl } from "@/lib/steam-api"
import { GameCard } from "@/components/ui/game-card"
import { useSteamAchievementsBatch } from "@/hooks/use-steam-data"
import { GamesFilterBar } from "@/components/ui/games-filter-bar"
import { PageContainer } from "@/components/ui/page-container"
import { LoadingMessage } from "@/components/ui/loading-message"
import { ErrorMessage } from "@/components/ui/error-message"

export default function GamesPage() {
  const { setTitle } = usePageTitle()
  useEffect(() => {
    setTitle("Games")
    return () => setTitle("")
  }, [setTitle])
  const { user, loading: loadingUser } = useCurrentUser()

  const [showCompleted, setShowCompleted] = useState(false)
  const [order, setOrder] = useState("completed")
  const [games, setGames] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Fetch achievements in batch for all games
  const appIds = useMemo(() => games.map(g => g.id), [games])
  const { achievementsMap, loading: achievementsLoading } = useSteamAchievementsBatch(appIds.length > 0 ? appIds : [])

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true)

        // Fetch games from endpoint
        const gamesRes = await fetch("/api/steam/games?type=all")
        if (!gamesRes.ok) throw new Error("Could not fetch games")
        const gamesData = await gamesRes.json()
        const ownedGames = gamesData.games || []

        // Load allowed IDs list
        const jsonRes = await fetch("/steam_games_with_achievements.json")
        const steamGamesList = await jsonRes.json()
        const allowedIds = new Set(steamGamesList.map((g: any) => String(g.id)))

        // Filter and map to show name and cover
        const filteredGames = ownedGames
          .filter((game: any) => allowedIds.has(String(game.appid)))
          .map((game: any) => ({
            id: game.appid,
            name: game.name,
            image: getSteamImageUrl(game.appid, game.img_icon_url, "icon"),
            playtime: Math.round(game.playtime_forever / 60),
          }))
        setGames(filteredGames)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error")
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  // Calculate % achievements and completion status
  const gamesWithStats = useMemo(() => {
    let arr = games.map((game) => {
      const achievements = achievementsMap[game.id] || []
      const unlocked = achievements.filter((a: any) => a.achieved === 1).length
      const total = achievements.length
      const percent = total > 0 ? Math.round((unlocked / total) * 100) : 0
      const completed = total > 0 && unlocked === total
      return { ...game, achievements, percent, completed, totalAchievements: total }
    })
    switch (order) {
      case "alphabetical":
        arr = arr.sort((a, b) => a.name.localeCompare(b.name))
        break
      case "achievementsAsc":
        arr = arr.sort((a, b) => a.totalAchievements - b.totalAchievements)
        break
      case "achievementsDesc":
        arr = arr.sort((a, b) => b.totalAchievements - a.totalAchievements)
        break
      case "completed":
      default:
        arr = arr.sort((a, b) => {
          if (a.completed !== b.completed) return b.completed - a.completed
          return b.percent - a.percent
        })
        break
    }
    return arr
  }, [games, achievementsMap, order])

  // Filter out completed games if requested
  const visibleGames = useMemo(() => (
    showCompleted ? gamesWithStats : gamesWithStats.filter(g => !g.completed)
  ), [gamesWithStats, showCompleted])

  if (loadingUser) {
    return <LoadingMessage />
  }

  if (!user) {
    return <ErrorMessage />
  }

  return (
    <PageContainer>
      <div className="grid gap-8">
        <UserProfile user={user} />
        <GamesFilterBar order={order} setOrder={setOrder} showCompleted={showCompleted} setShowCompleted={setShowCompleted} />
        {loading ? (
          <p className="text-center text-muted-foreground">Loading games...</p>
        ) : error ? (
          <p className="text-center text-destructive">{error}</p>
        ) : achievementsLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="p-3 rounded-lg bg-muted/50 border-2 animate-pulse flex items-center gap-4">
                <div className="w-16 h-16 rounded-lg bg-muted" />
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="h-4 w-32 bg-muted rounded" />
                  <div className="h-3 w-24 bg-muted rounded" />
                  <div className="h-4 w-20 bg-muted rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
            {visibleGames.map((game) => (
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
// ...existing code...
