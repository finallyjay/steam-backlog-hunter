"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { AlertCircle, Search, Sparkles } from "lucide-react"

import { useCurrentUser } from "@/hooks/use-current-user"
import { useSteamExtras } from "@/hooks/use-steam-data"
import { PageContainer } from "@/components/ui/page-container"
import { LoadingMessage } from "@/components/ui/loading-message"
import { GameCard } from "@/components/ui/game-card"
import { Skeleton } from "@/components/ui/skeleton"
import { getSteamHeaderImageUrl } from "@/lib/steam-api"

export default function ExtrasPage() {
  const { user, loading: loadingUser } = useCurrentUser()
  const router = useRouter()
  const { games, loading: loadingGames, error } = useSteamExtras()
  const [search, setSearch] = useState("")

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  useEffect(() => {
    if (!loadingUser && !user) {
      router.push("/")
    }
  }, [loadingUser, router, user])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return games
    return games.filter((g) => (g.name ?? `app #${g.appid}`).toLowerCase().includes(q))
  }, [games, search])

  if (loadingUser) return <LoadingMessage />
  if (!user) return null

  return (
    <PageContainer>
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="bg-accent/15 text-accent border-surface-4 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Extras</h1>
            <p className="text-muted-foreground max-w-2xl text-sm">
              Games Steam remembers you played at some point but that aren&apos;t in your main library: refunded,
              family-shared, delisted, or otherwise removed. These <strong>don&apos;t count</strong> in your library
              stats, insights or KPIs — they&apos;re tracked separately so you can still see them without contaminating
              anything else.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="border-surface-4 bg-surface-1 focus-within:border-accent flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border px-3">
            <Search className="text-muted-foreground h-4 w-4 shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search extras…"
              className="text-foreground placeholder:text-muted-foreground h-full w-full bg-transparent text-sm focus:outline-none"
            />
          </div>
          <p className="text-muted-foreground shrink-0 text-sm">
            {loadingGames
              ? "Loading…"
              : `${filtered.length}${filtered.length !== games.length ? ` of ${games.length}` : ""} games`}
          </p>
        </div>

        <hr className="border-surface-4" />

        {error ? (
          <div className="border-destructive/40 bg-destructive/5 flex items-start gap-3 rounded-lg border px-4 py-3">
            <AlertCircle className="text-destructive mt-0.5 h-4 w-4 shrink-0" />
            <div className="text-sm">
              <p className="text-destructive font-medium">Could not load extras</p>
              <p className="text-muted-foreground">{error}</p>
            </div>
          </div>
        ) : loadingGames ? (
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="border-surface-4 bg-surface-1 flex items-stretch gap-4 rounded-lg border px-4 py-4"
              >
                <Skeleton className="h-[5.9rem] w-48 rounded-2xl" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-5 w-44" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-2 w-full rounded-full" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="border-surface-4 bg-surface-1 rounded-lg border px-6 py-10 text-center">
            <p className="text-muted-foreground">No extras yet.</p>
            <p className="text-muted-foreground mt-1 text-sm">
              After syncing, games Steam remembers you played but no longer own will show up here.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map((game) => (
              <GameCard
                key={game.appid}
                id={game.appid}
                name={game.name ?? `App #${game.appid}`}
                image={game.image_landscape_url ?? getSteamHeaderImageUrl(game.appid)}
                playtime={Number(((game.playtime_forever ?? 0) / 60).toFixed(1))}
                href={`https://store.steampowered.com/app/${game.appid}`}
                achievements={[]}
                achievementsLoading={false}
                serverTotal={game.total_count ?? 0}
                serverUnlocked={game.unlocked_count ?? 0}
                serverPerfect={game.perfect_game === 1}
              />
            ))}
          </div>
        )}
      </div>
    </PageContainer>
  )
}
