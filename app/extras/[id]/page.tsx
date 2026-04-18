"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Database, ExternalLink, LifeBuoy, Lock, Trophy } from "lucide-react"

import { useCurrentUser } from "@/hooks/use-current-user"
import { LoadingMessage } from "@/components/ui/loading-message"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { GameHero } from "@/components/ui/game-hero"
import { AchievementRow } from "@/components/ui/achievement-row"
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
          <AchievementRow key={ach.apiname} achievement={ach} />
        ))}
      </ul>
    )
  }

  return (
    <div className="min-h-screen">
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
            <GameHero
              appId={game.appid}
              name={gameName}
              portraitUrl={game.image_portrait_url}
              title={
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-bold">{gameName}</h1>
                  <span className="bg-surface-3 text-muted-foreground rounded-full px-2 py-0.5 text-xs">Extra</span>
                </div>
              }
            >
              <div className="text-muted-foreground text-sm">{formatPlaytime(game.playtime_forever / 60)} played</div>

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
                <a href={`https://store.steampowered.com/app/${game.appid}`} target="_blank" rel="noopener noreferrer">
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
            </GameHero>

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
