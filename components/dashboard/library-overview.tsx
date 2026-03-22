"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { Library, Search } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useSteamGames } from "@/hooks/use-steam-data"
import { getSteamImageUrl } from "@/lib/steam-api"

export function LibraryOverview() {
  const { games, loading, error } = useSteamGames("all")
  const [query, setQuery] = useState("")

  const filteredGames = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return [...games]
      .filter((game) => game.name.toLowerCase().includes(normalizedQuery))
      .sort((a, b) => b.playtime_forever - a.playtime_forever)
  }, [games, query])

  return (
    <Card className="border-white/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Library className="h-5 w-5 text-accent" />
          Full Library
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search your library"
            className="h-10 w-full rounded-xl border border-white/10 bg-white/5 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-accent/50"
          />
        </div>

        {loading ? (
          <div className="rounded-[1rem] border border-white/8 bg-white/4 px-4 py-8 text-center text-sm text-muted-foreground">
            Loading library...
          </div>
        ) : error ? (
          <div className="rounded-[1rem] border border-destructive/30 bg-destructive/10 px-4 py-8 text-center text-sm text-destructive">
            Failed to load the full library.
          </div>
        ) : (
          <div className="rounded-[1rem] border border-white/8 bg-white/4">
            <div className="flex items-center justify-between border-b border-white/8 px-4 py-3 text-sm text-muted-foreground">
              <span>{filteredGames.length} visible games</span>
              <Link href="/games" className="text-accent transition-colors hover:text-accent/80">
                Open advanced view
              </Link>
            </div>
            <div className="max-h-[32rem] overflow-y-auto">
              {filteredGames.map((game) => (
                <Link
                  key={game.appid}
                  href={`/game/${game.appid}`}
                  className="flex items-center gap-3 border-b border-white/6 px-4 py-3 transition-colors hover:bg-white/5 last:border-b-0"
                >
                  <img
                    src={getSteamImageUrl(game.appid, game.img_icon_url)}
                    alt={game.name}
                    className="h-11 w-11 rounded-xl border border-white/10 bg-slate-900/70 object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{game.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(game.playtime_forever / 60).toFixed(1)} hours played
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
