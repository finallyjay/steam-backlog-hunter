"use client"

import { useSteamAchievements, useSteamGames } from "@/hooks/use-steam-data"
import { getSteamHeaderImageUrl } from "@/lib/steam-api"
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
import { ExternalLink, Lock, Trophy } from "lucide-react"
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

  const allAchievements = useMemo(() => (Array.isArray(achievements) ? achievements : []), [achievements])
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

  const displayList = activeTab === "pending" ? pending : unlocked

  let progressColor = "bg-danger"
  if (percent >= 80) progressColor = "bg-success"
  else if (percent >= 40) progressColor = "bg-warning"

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
          <div className="mb-8 flex items-start gap-6">
            <img
              src={game.image_portrait_url || game.image_landscape_url || getSteamHeaderImageUrl(game.appid)}
              alt={`Cover art for ${game.name}`}
              className="w-44 rounded-lg border"
            />
            <div className="flex-1 space-y-4 pt-1">
              <div>
                <h1 className="mb-1 text-2xl font-bold">{game.name}</h1>
                <div className="text-muted-foreground text-sm">{formatPlaytime(game.playtime_forever / 60)} played</div>
              </div>

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
              </div>
            </div>
          </div>
        )}

        {game && (
          <>
            <div className="mb-4">
              <div className="bg-card/80 border-surface-4 inline-flex gap-2 rounded-lg border p-2">
                <Button
                  variant={activeTab === "pending" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setActiveTab("pending")}
                  className={
                    activeTab === "pending"
                      ? "bg-accent hover:bg-accent/90 text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-surface-3"
                  }
                >
                  <Lock className="h-4 w-4" />
                  Pending{!loadingAchievements && ` (${pending.length})`}
                </Button>
                <Button
                  variant={activeTab === "unlocked" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setActiveTab("unlocked")}
                  className={
                    activeTab === "unlocked"
                      ? "bg-accent hover:bg-accent/90 text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-surface-3"
                  }
                >
                  <Trophy className="h-4 w-4" />
                  Unlocked{!loadingAchievements && ` (${unlocked.length})`}
                </Button>
              </div>
            </div>

            {loadingAchievements ? (
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
            ) : errorAchievements ? (
              <EmptyState message="Could not load achievements." />
            ) : displayList.length === 0 ? (
              <EmptyState
                message={
                  activeTab === "pending"
                    ? "You have no pending achievements for this game!"
                    : "No unlocked achievements yet."
                }
              />
            ) : (
              <ul className="grid gap-3">
                {displayList.map((ach) => (
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
            )}
          </>
        )}
      </div>
    </div>
  )
}
