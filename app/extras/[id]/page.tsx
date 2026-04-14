"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Database, ExternalLink, LifeBuoy, Lock, Trophy } from "lucide-react"

import { useCurrentUser } from "@/hooks/use-current-user"
import { usePageTitle } from "@/components/ui/page-title-context"
import { LoadingMessage } from "@/components/ui/loading-message"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { getSteamHeaderImageUrl } from "@/lib/steam-api"
import { formatPlaytime } from "@/lib/utils"
import type { SteamAchievementView } from "@/lib/types/steam"

type ExtraGameDetail = {
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
}

type ExtraDetailResponse = {
  game: ExtraGameDetail
  achievements: SteamAchievementView[]
}

type AchievementTab = "pending" | "unlocked"

function sortByUnlockDateDesc(a: SteamAchievementView, b: SteamAchievementView) {
  if (!a.unlocktime && !b.unlocktime) return 0
  if (!a.unlocktime) return 1
  if (!b.unlocktime) return -1
  return b.unlocktime - a.unlocktime
}

export default function ExtraGameDetailPage() {
  const params = useParams<{ id: string }>()
  const appId = Number(params.id)
  const { user, loading: loadingUser } = useCurrentUser()
  const router = useRouter()
  const { setTitle } = usePageTitle()
  const [game, setGame] = useState<ExtraGameDetail | null>(null)
  const [achievements, setAchievements] = useState<SteamAchievementView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<AchievementTab>("pending")

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/steam/extras/${appId}`)
      if (!res.ok) {
        if (res.status === 404) {
          setError("Extra game not found")
        } else {
          setError("Failed to load game details")
        }
        return
      }
      const data = (await res.json()) as ExtraDetailResponse
      setGame(data.game)
      setAchievements(data.achievements)
    } catch {
      setError("Network error")
    } finally {
      setLoading(false)
    }
  }, [appId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  useEffect(() => {
    if (!loadingUser && !user) {
      router.push("/")
    }
  }, [loadingUser, router, user])

  useEffect(() => {
    if (game?.name) {
      setTitle(`${game.name} - Steam Backlog Hunter`)
    }
    return () => setTitle("")
  }, [game?.name, setTitle])

  const pending = useMemo(() => achievements.filter((a) => !a.achieved).sort(sortByUnlockDateDesc), [achievements])
  const unlocked = useMemo(
    () => achievements.filter((a) => a.achieved === 1).sort(sortByUnlockDateDesc),
    [achievements],
  )
  const total = achievements.length
  const unlockedCount = unlocked.length
  const percent = total > 0 ? Math.round((unlockedCount / total) * 100) : 0

  if (loadingUser) return <LoadingMessage />
  if (!user) return null

  let progressColor = "bg-danger"
  if (percent >= 80) progressColor = "bg-success"
  else if (percent >= 40) progressColor = "bg-warning"

  const gameName = game?.name || `App #${appId}`

  // Shared renderer for both tab panels. Extras doesn't need a loading/error
  // branch here because total > 0 gates the whole Tabs block.
  const renderAchievementPanel = (list: SteamAchievementView[], emptyMessage: string) => {
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
        {loading ? (
          <div className="mb-8 flex items-center gap-6">
            <Skeleton className="h-64 w-44 rounded-lg" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
        ) : error ? (
          <EmptyState message={error} />
        ) : game ? (
          <>
            <div className="mb-8 flex items-start gap-6">
              <img
                src={game.image_portrait_url || game.image_landscape_url || getSteamHeaderImageUrl(game.appid)}
                alt={`Cover art for ${gameName}`}
                className="w-44 rounded-lg border"
              />
              <div className="flex-1 space-y-4 pt-1">
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <h1 className="text-2xl font-bold">{gameName}</h1>
                    <span className="bg-surface-3 text-muted-foreground rounded-full px-2 py-0.5 text-xs">Extra</span>
                  </div>
                  <div className="text-muted-foreground text-sm">
                    {formatPlaytime(game.playtime_forever / 60)} played
                  </div>
                </div>

                {total > 0 && (
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

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <a
                    href={`https://store.steampowered.com/app/${game.appid}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button variant="outline" size="sm" className="gap-2">
                      <ExternalLink className="h-4 w-4" />
                      Steam Store
                    </Button>
                  </a>
                  <a href={`https://steamdb.info/app/${game.appid}/`} target="_blank" rel="noopener noreferrer">
                    <Button variant="outline" size="sm" className="gap-2">
                      <Database className="h-4 w-4" />
                      SteamDB
                    </Button>
                  </a>
                  <a
                    href={`https://help.steampowered.com/en/wizard/HelpWithGameIssue/?appid=${game.appid}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button variant="outline" size="sm" className="gap-2">
                      <LifeBuoy className="h-4 w-4" />
                      Support
                    </Button>
                  </a>
                </div>
              </div>
            </div>

            {total > 0 && (
              <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as AchievementTab)}>
                <TabsList>
                  <TabsTrigger value="pending">
                    <Lock className="h-4 w-4" />
                    Pending ({pending.length})
                  </TabsTrigger>
                  <TabsTrigger value="unlocked">
                    <Trophy className="h-4 w-4" />
                    Unlocked ({unlocked.length})
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="pending">
                  {renderAchievementPanel(pending, "No pending achievements for this game!")}
                </TabsContent>
                <TabsContent value="unlocked">
                  {renderAchievementPanel(unlocked, "No unlocked achievements yet.")}
                </TabsContent>
              </Tabs>
            )}

            {total === 0 && !loading && (
              <EmptyState message="This game has no achievements or they haven't been synced yet." />
            )}
          </>
        ) : null}
      </div>
    </div>
  )
}
