"use client"

import { useSteamAchievements, useSteamGames } from "@/hooks/use-steam-data"
import { getSteamImageUrl } from "@/lib/steam-api"
import { useCurrentUser } from "@/hooks/use-current-user"
import { useParams, useRouter } from "next/navigation"
import { Skeleton } from "@/components/ui/skeleton"
import { LoadingMessage } from "@/components/ui/loading-message"
import { SectionTitle } from "@/components/ui/section-title"
import { EmptyState } from "@/components/ui/empty-state"
import { useEffect } from "react"
import { usePageTitle } from "@/components/ui/page-title-context"
import type { SteamAchievementView } from "@/lib/types/steam"
import { Button } from "@/components/ui/button"
import { RefreshCw } from "lucide-react"

function sortByUnlockDateDesc(a: SteamAchievementView, b: SteamAchievementView) {
  if (!a.unlocktime && !b.unlocktime) return 0
  if (!a.unlocktime) return 1
  if (!b.unlocktime) return -1
  return b.unlocktime - a.unlocktime
}

export default function GameDetailPage() {
  const params = useParams<{ id: string }>()
  const appId = Number(params.id)
  const {
    achievements,
    loading: loadingAchievements,
    isRefreshing: isRefreshingAchievements,
    lastUpdated,
    error: errorAchievements,
    refetch,
  } = useSteamAchievements(appId)
  const { games, loading: loadingGames } = useSteamGames("all")
  const { user, loading: loadingUser } = useCurrentUser()
  const router = useRouter()
  const { setTitle } = usePageTitle()
  useEffect(() => {
    setTitle("")
    return () => setTitle("")
  }, [setTitle])

  useEffect(() => {
    if (!loadingUser && !user) {
      router.push("/")
    }
  }, [loadingUser, router, user])

  // User protection
  if (loadingUser) {
    return <LoadingMessage />
  }
  if (!user) {
    return null
  }

  // Find the game in the user's games list
  const game = games.find(g => g.appid === appId)
  // Filter only locked achievements and sort by unlock date desc
  const locked = (Array.isArray(achievements) ? achievements : [])
    .filter((ach) => !ach.achieved)
    .sort(sortByUnlockDateDesc)
  const updatedLabel = lastUpdated ? `Updated at ${lastUpdated.toLocaleTimeString()}` : "Not updated yet"

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted">
      <div className="container mx-auto px-4 py-8">
        {/* Header Juego */}
        {loadingGames ? (
          <div className="flex items-center gap-6 mb-8">
            <Skeleton className="w-12 h-12 rounded-lg" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
        ) : !game ? (
          <EmptyState message="Game not found." />
        ) : (
          <div className="flex items-center gap-6 mb-8">
            <img
              src={getSteamImageUrl(game.appid, game.img_icon_url)}
              alt={game.name}
              className="w-12 h-12 rounded-lg border object-contain"
            />
            <div>
              <SectionTitle className="text-lg font-bold mb-1">{game.name}</SectionTitle>
              <div className="text-muted-foreground text-sm">{(game.playtime_forever / 60).toFixed(1)} hours played</div>
            </div>
          </div>
        )}
        <div className="mb-4 flex items-center justify-between gap-3">
          <SectionTitle className="mb-0">Pending achievements</SectionTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            disabled={isRefreshingAchievements}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshingAchievements ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mb-6">
          {updatedLabel}
        </p>
        {loadingAchievements ? (
          <div className="grid gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="p-4 bg-card rounded shadow flex items-center gap-4">
                <Skeleton className="w-12 h-12 rounded" />
                <div className="flex-1 min-w-0 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-4 w-20" />
                </div>
              </div>
            ))}
          </div>
        ) : errorAchievements ? (
          <EmptyState message="Could not load achievements." />
        ) : (
          <ul className="grid gap-4">
            {locked.length === 0 ? (
              <EmptyState message="You have no pending achievements for this game!" />
            ) : (
              locked.map((ach) => (
                <li key={ach.apiname} className="p-4 bg-card rounded shadow flex items-center gap-4 opacity-60">
                  <img
                    src={ach.icongray || ach.icon || "/placeholder.svg"}
                    alt={ach.displayName}
                    className="w-12 h-12"
                  />
                  <div>
                    <div className="font-bold">{ach.displayName}</div>
                    <div className="text-muted-foreground">{ach.description}</div>
                  </div>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </div>
  )
}
