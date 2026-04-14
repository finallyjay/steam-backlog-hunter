"use client"

import { useCallback, useEffect, useState } from "react"
import { Check, ExternalLink, HelpCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { LoadingMessage } from "@/components/ui/loading-message"
import { SurfaceCard } from "@/components/ui/surface-card"
import { formatPlaytime } from "@/lib/utils"

type Orphan = {
  appid: number
  current_name: string | null
  sources: Array<"library" | "extras">
  playtime_forever: number
  rtime_first_played: number | null
  rtime_last_played: number | null
}

function formatLastPlayed(ts: number | null): string {
  if (!ts) return "never"
  return new Date(ts * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
}

export default function OrphanNamesPage() {
  const [orphans, setOrphans] = useState<Orphan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [savingAppid, setSavingAppid] = useState<number | null>(null)

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/orphan-names")
    if (!res.ok) throw new Error("Failed to load")
    const data = (await res.json()) as { orphans: Orphan[] }
    setOrphans(data.orphans)
  }, [])

  useEffect(() => {
    load()
      .catch(() => setError("Failed to load orphan names"))
      .finally(() => setLoading(false))
  }, [load])

  const handleSave = async (appid: number) => {
    const name = (drafts[appid] ?? "").trim()
    if (name.length === 0) {
      setError("Name cannot be empty")
      return
    }
    setError(null)
    setSavingAppid(appid)
    try {
      const res = await fetch(`/api/admin/orphan-names/${appid}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to save name")
      }
      setOrphans((prev) => prev.filter((o) => o.appid !== appid))
      setDrafts((prev) => {
        const next = { ...prev }
        delete next[appid]
        return next
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save name")
    } finally {
      setSavingAppid(null)
    }
  }

  if (loading) return <LoadingMessage />

  return (
    <div>
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Orphan names</h1>
        <span className="text-muted-foreground text-xs">
          {orphans.length} unresolved app{orphans.length === 1 ? "" : "s"}
        </span>
      </div>

      <p className="text-muted-foreground mb-6 text-sm">
        Games that every auto-resolution source failed to name. Use the Steam Support and SteamDB links to identify the
        app, then type a name and save. Manual names are frozen — the sync chain will never overwrite them. Use the
        reset button to let the chain try again from scratch.
      </p>

      {error && <div className="bg-destructive/10 text-destructive mb-4 rounded-md px-4 py-3 text-sm">{error}</div>}

      {orphans.length === 0 ? (
        <SurfaceCard>
          <div className="flex items-center gap-3 px-2 py-6">
            <Check className="text-success h-5 w-5" />
            <div>
              <p className="text-sm font-medium">Nothing to resolve</p>
              <p className="text-muted-foreground text-xs">
                Every referenced app in library and extras currently has a name.
              </p>
            </div>
          </div>
        </SurfaceCard>
      ) : (
        <div className="space-y-2">
          {orphans.map((o) => {
            const draft = drafts[o.appid] ?? ""
            const busy = savingAppid === o.appid
            return (
              <SurfaceCard key={o.appid} variant="admin-item">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-foreground text-sm font-medium">App #{o.appid}</p>
                    <span className="text-muted-foreground text-xs">
                      {o.sources.includes("library") && o.sources.includes("extras")
                        ? "library + extras"
                        : o.sources[0]}
                    </span>
                    <a
                      href={`https://help.steampowered.com/en/wizard/HelpWithGame/?appid=${o.appid}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
                      aria-label="Open Steam Support page"
                    >
                      <HelpCircle className="h-3 w-3" /> Support
                    </a>
                    <a
                      href={`https://steamdb.info/app/${o.appid}/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
                      aria-label="Open SteamDB page"
                    >
                      <ExternalLink className="h-3 w-3" /> SteamDB
                    </a>
                  </div>
                  <div className="text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 text-xs">
                    <span>Playtime: {formatPlaytime(o.playtime_forever / 60)}</span>
                    <span>Last played: {formatLastPlayed(o.rtime_last_played)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={draft}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [o.appid]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleSave(o.appid)
                    }}
                    placeholder="Type a name…"
                    aria-label={`Name for app ${o.appid}`}
                    className="border-surface-4 bg-surface-1 text-foreground placeholder:text-muted-foreground focus:border-accent w-56 rounded-md border px-3 py-1.5 text-sm focus:outline-none"
                    disabled={busy}
                  />
                  <Button
                    size="sm"
                    onClick={() => handleSave(o.appid)}
                    disabled={busy || draft.trim().length === 0}
                    className="gap-1.5"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Save
                  </Button>
                </div>
              </SurfaceCard>
            )
          })}
        </div>
      )}
    </div>
  )
}
