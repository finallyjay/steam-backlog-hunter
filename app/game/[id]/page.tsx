"use client"

import { useSteamAchievements, useSteamGames } from "@/hooks/use-steam-data"
import { GameHero } from "@/components/ui/game-hero"
import { useCurrentUser } from "@/hooks/use-current-user"
import { useParams, useRouter } from "next/navigation"
import { Skeleton } from "@/components/ui/skeleton"
import { LoadingMessage } from "@/components/ui/loading-message"
import { EmptyState } from "@/components/ui/empty-state"
import { useEffect, useMemo, useState } from "react"
import { usePageTitle } from "@/components/ui/page-title-context"
import type { SteamAchievementView } from "@/lib/types/steam"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ExternalLink, Lock, RefreshCw, Trophy } from "lucide-react"
import { formatPlaytime } from "@/lib/utils"

type AchievementTab = "pending" | "unlocked"

function sortByUnlockDateDesc(a: SteamAchievementView, b: SteamAchievementView) {
  if (!a.unlocktime && !b.unlocktime) return 0
  if (!a.unlocktime) return 1
  if (!b.unlocktime) return -1
  return b.unlocktime - a.unlocktime
}

export default function GameDetailPage() {
  const params = useParams<{ id: string }>()
  const appId = Number(params.id)
  const { achievements, loading: loadingAchievements, error: errorAchievements } = useSteamAchievements(appId)
  const { games, loading: loadingGames } = useSteamGames("all")
  const { user, loading: loadingUser } = useCurrentUser()
  const router = useRouter()
  const { setTitle } = usePageTitle()
  const [activeTab, setActiveTab] = useState<AchievementTab>("pending")
  const [syncing, setSyncing] = useState(false)
  const [syncedAchievements, setSyncedAchievements] = useState<SteamAchievementView[] | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)

  const game = games.find((g) => g.appid === appId)

  useEffect(() => {
    if (game?.name) {
      setTitle(`${game.name} - Steam Backlog Hunter`)
    }
    return () => setTitle("")
  }, [game?.name, setTitle])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  useEffect(() => {
    if (!loadingUser && !user) {
      router.push("/")
    }
  }, [loadingUser, router, user])

  const handleSync = async () => {
    setSyncing(true)
    setSyncError(null)
    try {
      const res = await fetch(`/api/steam/game/${appId}/sync`, { method: "POST" })
      if (res.ok) {
        const data = await res.json()
        setSyncedAchievements(data.achievements ?? [])
      } else {
        const data = await res.json().catch(() => null)
        setSyncError(data?.error ?? "Sync failed")
      }
    } catch {
      setSyncError("Network error")
    } finally {
      setSyncing(false)
    }
  }

  const effectiveAchievements = syncedAchievements ?? achievements
  const allAchievements = useMemo(
    () => (Array.isArray(effectiveAchievements) ? effectiveAchievements : []),
    [effectiveAchievements],
  )
  const pending = useMemo(
    () => allAchievements.filter((a) => !a.achieved).sort(sortByUnlockDateDesc),
    [allAchievements],
  )
  const unlocked = useMemo(
    () => allAchievements.filter((a) => a.achieved === 1).sort(sortByUnlockDateDesc),
    [allAchievements],
  )
  const total = allAchievements.length
  const unlockedCount = unlocked.length
  const percent = total > 0 ? Math.round((unlockedCount / total) * 100) : 0

  if (loadingUser) {
    return <LoadingMessage />
  }
  if (!user) {
    return null
  }

  let progressColor = "bg-danger"
  if (percent >= 80) progressColor = "bg-success"
  else if (percent >= 40) progressColor = "bg-warning"

  // Shared panel renderer so the loading/error/empty/list logic lives in one
  // place across both tabs. Radix only mounts the active panel, but the
  // helper keeps the TabsContent blocks compact and DRY.
  const renderAchievementPanel = (list: SteamAchievementView[], emptyMessage: string) => {
    if (loadingAchievements) {
      return (
        <div className="grid gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-card flex items-center gap-4 rounded p-4 shadow">
              <Skeleton className="h-12 w-12 rounded" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          ))}
        </div>
      )
    }
    if (errorAchievements && !syncedAchievements) {
      return <EmptyState message="Could not load achievements." />
    }
    if (list.length === 0) {
      return <EmptyState message={emptyMessage} />
    }
    return (
      <ul className="grid gap-3">
        {list.map((ach) => (
          <li
            key={ach.apiname}
            className={`border-surface-4 flex items-center gap-4 rounded-lg border p-4 transition-colors ${
              ach.achieved ? "bg-surface-1" : "bg-white/2 opacity-70"
            }`}
          >
            <img
              src={(ach.achieved ? ach.icon : ach.icongray) || ach.icon || "/placeholder-icon.svg"}
              alt={`Icon for ${ach.displayName} achievement`}
              className="h-12 w-12 rounded-lg"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{ach.displayName}</div>
              {ach.description && <div className="text-muted-foreground text-sm">{ach.description}</div>}
            </div>
            {ach.achieved && ach.unlocktime ? (
              <div className="text-muted-foreground text-right text-xs">
                <div>
                  {new Date(ach.unlocktime * 1000).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </div>
                <div>
                  {new Date(ach.unlocktime * 1000).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div className="from-background to-muted min-h-screen bg-gradient-to-br">
      <div className="container mx-auto px-4 py-8">
        {loadingGames ? (
          <div className="mb-8 flex items-center gap-6">
            <Skeleton className="h-64 w-44 rounded-lg" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
        ) : !game ? (
          <EmptyState message="Game not found." />
        ) : (
          <GameHero appId={game.appid} name={game.name} portraitUrl={game.image_portrait_url}>
            <div className="text-muted-foreground text-sm">{formatPlaytime(game.playtime_forever / 60)} played</div>

            {!loadingAchievements && total > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground font-medium">Achievement progress</span>
                  <span className="font-medium">
                    {unlockedCount}/{total} ({percent}%)
                  </span>
                </div>
                <Progress value={percent} indicatorClassName={progressColor} />
              </div>
            )}

            <div className="flex items-center gap-3 pt-1">
              <a href={`https://store.steampowered.com/app/${game.appid}`} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm" className="gap-2">
                  <ExternalLink className="h-4 w-4" />
                  Steam Store
                </Button>
              </a>
              <Button variant="outline" size="sm" className="gap-2" onClick={handleSync} disabled={syncing}>
                <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Syncing..." : "Update achievements"}
              </Button>
              {syncError && <span className="text-destructive text-sm">{syncError}</span>}
            </div>
          </GameHero>
        )}

        {game && (
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as AchievementTab)}>
            <TabsList>
              <TabsTrigger value="pending">
                <Lock className="h-4 w-4" />
                Pending{!loadingAchievements && ` (${pending.length})`}
              </TabsTrigger>
              <TabsTrigger value="unlocked">
                <Trophy className="h-4 w-4" />
                Unlocked{!loadingAchievements && ` (${unlocked.length})`}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="pending">
              {renderAchievementPanel(pending, "You have no pending achievements for this game!")}
            </TabsContent>
            <TabsContent value="unlocked">
              {renderAchievementPanel(unlocked, "No unlocked achievements yet.")}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  )
}
