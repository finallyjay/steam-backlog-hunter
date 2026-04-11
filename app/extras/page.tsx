"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { AlertCircle, Search } from "lucide-react"

import { useCurrentUser } from "@/hooks/use-current-user"
import { useSteamExtras } from "@/hooks/use-steam-data"
import { PageContainer } from "@/components/ui/page-container"
import { LoadingMessage } from "@/components/ui/loading-message"
import { formatPlaytime } from "@/lib/utils"

function formatDate(unixSeconds: number | null) {
  if (!unixSeconds) return "—"
  const d = new Date(unixSeconds * 1000)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

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
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Extras</h1>
          <p className="text-muted-foreground max-w-2xl text-sm">
            Games Steam remembers you played at some point but that aren&apos;t in your main library: refunded,
            family-shared, delisted, or otherwise removed. These <strong>don&apos;t count</strong> in your library
            stats, insights, or KPIs — they&apos;re tracked separately so you can still see them without contaminating
            anything else.
          </p>
        </div>

        <div className="border-surface-4 bg-surface-1 focus-within:border-accent flex h-9 items-center gap-2 rounded-lg border px-3">
          <Search className="text-muted-foreground h-4 w-4 shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search extras…"
            className="text-foreground placeholder:text-muted-foreground h-full w-full bg-transparent text-sm focus:outline-none"
          />
          <span className="text-muted-foreground shrink-0 text-sm">
            {loadingGames ? "Loading…" : `${filtered.length} of ${games.length}`}
          </span>
        </div>

        {error ? (
          <div className="border-destructive/40 bg-destructive/5 flex items-start gap-3 rounded-lg border px-4 py-3">
            <AlertCircle className="text-destructive mt-0.5 h-4 w-4 shrink-0" />
            <div className="text-sm">
              <p className="text-destructive font-medium">Could not load extras</p>
              <p className="text-muted-foreground">{error}</p>
            </div>
          </div>
        ) : loadingGames ? (
          <p className="text-muted-foreground py-8 text-center text-sm">Loading extras…</p>
        ) : filtered.length === 0 ? (
          <div className="border-surface-4 bg-surface-1 rounded-lg border px-6 py-10 text-center">
            <p className="text-muted-foreground">No extras yet.</p>
            <p className="text-muted-foreground mt-1 text-sm">
              After syncing, games Steam remembers you played but no longer own will show up here.
            </p>
          </div>
        ) : (
          <div className="border-surface-4 bg-surface-1 overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground border-surface-4 border-b text-left text-xs tracking-wider uppercase">
                <tr>
                  <th className="px-4 py-2 font-medium">Game</th>
                  <th className="px-4 py-2 font-medium">Playtime</th>
                  <th className="hidden px-4 py-2 font-medium md:table-cell">First played</th>
                  <th className="hidden px-4 py-2 font-medium md:table-cell">Last played</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((game) => (
                  <tr key={game.appid} className="border-surface-4/50 hover:bg-surface-2 border-t">
                    <td className="px-4 py-2.5">
                      <a
                        href={`https://store.steampowered.com/app/${game.appid}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-accent text-foreground"
                      >
                        {game.name ?? `App #${game.appid}`}
                      </a>
                    </td>
                    <td className="text-muted-foreground px-4 py-2.5 tabular-nums">
                      {formatPlaytime(game.playtime_forever / 60)}
                    </td>
                    <td className="text-muted-foreground hidden px-4 py-2.5 tabular-nums md:table-cell">
                      {formatDate(game.rtime_first_played)}
                    </td>
                    <td className="text-muted-foreground hidden px-4 py-2.5 tabular-nums md:table-cell">
                      {formatDate(game.rtime_last_played)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageContainer>
  )
}
