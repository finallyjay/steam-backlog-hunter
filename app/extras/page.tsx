"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { AlertCircle, Database, EyeOff, LifeBuoy, RotateCcw, Search, Sparkles } from "lucide-react"

import { useCurrentUser } from "@/hooks/use-current-user"
import { useSteamExtras, useSteamHiddenGames } from "@/hooks/use-steam-data"
import { PageContainer } from "@/components/ui/page-container"
import { LoadingMessage } from "@/components/ui/loading-message"
import { GameCard } from "@/components/ui/game-card"
import { InputFrame } from "@/components/ui/input-frame"
import { Skeleton } from "@/components/ui/skeleton"
import { SurfaceCard } from "@/components/ui/surface-card"
import { getSteamHeaderImageUrl } from "@/lib/steam-api"

type Tab = "extras" | "hidden"

function ExtraGameActions({ appid }: { appid: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <a
        href={`https://steamdb.info/app/${appid}/`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-white/5"
      >
        <Database className="h-3 w-3" />
        <span>SteamDB</span>
      </a>
      <a
        href={`https://help.steampowered.com/en/wizard/HelpWithGameIssue/?appid=${appid}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-white/5"
      >
        <LifeBuoy className="h-3 w-3" />
        <span>Support</span>
      </a>
    </div>
  )
}

export default function ExtrasPage() {
  const { user, loading: loadingUser } = useCurrentUser()
  const router = useRouter()
  const { games: extras, loading: loadingExtras, error: extrasError, refetch: refetchExtras } = useSteamExtras()
  const { games: hidden, loading: loadingHidden, error: hiddenError, refetch: refetchHidden } = useSteamHiddenGames()
  const [tab, setTab] = useState<Tab>("extras")
  const [search, setSearch] = useState("")
  const [locallyHidden, setLocallyHidden] = useState<Set<number>>(new Set())
  const [locallyRestored, setLocallyRestored] = useState<Set<number>>(new Set())

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  useEffect(() => {
    if (!loadingUser && !user) {
      router.push("/")
    }
  }, [loadingUser, router, user])

  const handleHide = useCallback(async (appId: number) => {
    try {
      const res = await fetch("/api/steam/games/hide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId }),
      })
      if (res.ok) {
        setLocallyHidden((prev) => new Set([...prev, appId]))
      }
    } catch {
      // ignore
    }
  }, [])

  const handleRestore = useCallback(async (appId: number) => {
    try {
      const res = await fetch("/api/steam/games/hide", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId }),
      })
      if (res.ok) {
        setLocallyRestored((prev) => new Set([...prev, appId]))
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    if (tab === "hidden" && (locallyHidden.size > 0 || locallyRestored.size > 0)) {
      void refetchHidden()
      setLocallyRestored(new Set())
    }
    if (tab === "extras" && locallyHidden.size > 0) {
      void refetchExtras()
      setLocallyHidden(new Set())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const filteredExtras = useMemo(() => {
    const visible = extras.filter((g) => !locallyHidden.has(g.appid))
    const q = search.trim().toLowerCase()
    if (!q) return visible
    return visible.filter((g) => (g.name || `app #${g.appid}`).toLowerCase().includes(q))
  }, [extras, search, locallyHidden])

  const filteredHidden = useMemo(() => {
    const visible = hidden.filter((g) => !locallyRestored.has(g.appid))
    const q = search.trim().toLowerCase()
    if (!q) return visible
    return visible.filter((g) => (g.name || `app #${g.appid}`).toLowerCase().includes(q))
  }, [hidden, search, locallyRestored])

  const loading = tab === "extras" ? loadingExtras : loadingHidden
  const error = tab === "extras" ? extrasError : hiddenError
  const totalCount = tab === "extras" ? extras.length - locallyHidden.size : hidden.length - locallyRestored.size
  const filteredCount = tab === "extras" ? filteredExtras.length : filteredHidden.length

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

        <div className="border-surface-4 flex gap-1 rounded-lg border p-1">
          <button
            type="button"
            onClick={() => setTab("extras")}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${tab === "extras" ? "bg-surface-3 text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-surface-2"}`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Extras
          </button>
          <button
            type="button"
            onClick={() => setTab("hidden")}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${tab === "hidden" ? "bg-surface-3 text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-surface-2"}`}
          >
            <EyeOff className="h-3.5 w-3.5" />
            Hidden
            {hidden.length > 0 && (
              <span className="bg-surface-4 text-muted-foreground rounded-full px-1.5 py-0.5 text-xs">
                {hidden.length}
              </span>
            )}
          </button>
        </div>

        <div className="flex items-center justify-between gap-4">
          <InputFrame className="min-w-0 flex-1">
            <Search className="text-muted-foreground h-4 w-4 shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tab === "extras" ? "Search extras\u2026" : "Search hidden games\u2026"}
              aria-label={tab === "extras" ? "Search extras" : "Search hidden games"}
              className="text-foreground placeholder:text-muted-foreground h-full w-full bg-transparent text-sm outline-none"
            />
          </InputFrame>
          <p className="text-muted-foreground shrink-0 text-sm">
            {loading
              ? "Loading\u2026"
              : `${filteredCount}${filteredCount !== totalCount ? ` of ${totalCount}` : ""} games`}
          </p>
        </div>

        <hr className="border-surface-4" />

        {error ? (
          <div className="border-destructive/40 bg-destructive/5 flex items-start gap-3 rounded-lg border px-4 py-3">
            <AlertCircle className="text-destructive mt-0.5 h-4 w-4 shrink-0" />
            <div className="text-sm">
              <p className="text-destructive font-medium">
                Could not load {tab === "extras" ? "extras" : "hidden games"}
              </p>
              <p className="text-muted-foreground">{error}</p>
            </div>
          </div>
        ) : loading ? (
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <SurfaceCard key={i} variant="row" className="flex items-stretch gap-4">
                <Skeleton className="h-[5.9rem] w-48 rounded-2xl" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-5 w-44" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-2 w-full rounded-full" />
                </div>
              </SurfaceCard>
            ))}
          </div>
        ) : tab === "extras" ? (
          filteredExtras.length === 0 ? (
            <SurfaceCard variant="empty">
              <p className="text-muted-foreground">No extras yet.</p>
              <p className="text-muted-foreground mt-1 text-sm">
                After syncing, games Steam remembers you played but no longer own will show up here.
              </p>
            </SurfaceCard>
          ) : (
            <div className="space-y-4">
              {filteredExtras.map((game) => (
                <GameCard
                  key={game.appid}
                  id={game.appid}
                  name={game.name || `App #${game.appid}`}
                  image={game.image_landscape_url ?? getSteamHeaderImageUrl(game.appid)}
                  imagePortrait={game.image_portrait_url}
                  playtime={Number(((game.playtime_forever ?? 0) / 60).toFixed(1))}
                  href={`/extras/${game.appid}`}
                  achievements={[]}
                  achievementsLoading={false}
                  serverTotal={game.total_count ?? 0}
                  serverUnlocked={game.unlocked_count ?? 0}
                  serverPerfect={game.perfect_game === 1}
                  onHide={handleHide}
                  actions={<ExtraGameActions appid={game.appid} />}
                />
              ))}
            </div>
          )
        ) : filteredHidden.length === 0 ? (
          <SurfaceCard variant="empty">
            <p className="text-muted-foreground">No hidden games.</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Games you hide from the library or extras will appear here so you can restore them.
            </p>
          </SurfaceCard>
        ) : (
          <div className="space-y-4">
            {filteredHidden.map((game) => (
              <GameCard
                key={game.appid}
                id={game.appid}
                name={game.name || `App #${game.appid}`}
                image={game.image_landscape_url ?? getSteamHeaderImageUrl(game.appid)}
                imagePortrait={game.image_portrait_url}
                playtime={game.playtime_forever != null ? Number((game.playtime_forever / 60).toFixed(1)) : undefined}
                href={`https://store.steampowered.com/app/${game.appid}`}
                achievements={[]}
                achievementsLoading={false}
                actions={
                  <div className="flex items-center gap-2">
                    <span className="bg-surface-3 text-muted-foreground rounded-full px-2 py-0.5 text-xs">
                      {game.source === "library" ? "Library" : "Extras"}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        void handleRestore(game.appid)
                      }}
                      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-white/5"
                    >
                      <RotateCcw className="h-3 w-3" />
                      <span>Restore</span>
                    </button>
                  </div>
                }
              />
            ))}
          </div>
        )}
      </div>
    </PageContainer>
  )
}
