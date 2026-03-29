"use client"

import { useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { invalidateSteamData } from "@/hooks/use-steam-data"
import { useToast } from "@/hooks/use-toast"

type SyncStatusResponse = {
  lastOwnedGamesSyncAt: string | null
  lastRecentGamesSyncAt: string | null
  lastStatsSyncAt: string | null
}

type SyncResultResponse = {
  syncedAt: string
  ownedGames: number
  recentGames: number
  stats: {
    totalGames: number
    totalAchievements: number
    totalPlaytime: number
    perfectGames: number
  }
}

type ApiErrorResponse = {
  error?: string
  details?: string
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return null
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return `Last sync ${date.toLocaleString()}`
}

/** Returns the last sync timestamp label, or null if not synced yet. */
export function useSyncStatus() {
  const [status, setStatus] = useState<SyncStatusResponse | null>(null)
  const [loading, setLoading] = useState(true)

  async function loadStatus() {
    try {
      setLoading(true)
      const response = await fetch("/api/steam/sync", { cache: "no-store" })
      if (!response.ok) return
      const data = (await response.json()) as SyncStatusResponse
      setStatus(data)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadStatus()
  }, [])

  const label =
    formatTimestamp(status?.lastStatsSyncAt ?? null) ??
    formatTimestamp(status?.lastOwnedGamesSyncAt ?? null) ??
    formatTimestamp(status?.lastRecentGamesSyncAt ?? null)

  return { label, loading, reload: loadStatus }
}

export function SyncStatusButton() {
  const [syncing, setSyncing] = useState(false)
  const { toast } = useToast()
  const { reload } = useSyncStatus()

  async function handleSync() {
    try {
      setSyncing(true)
      const response = await fetch("/api/steam/sync", {
        method: "POST",
      })

      if (!response.ok) {
        const errorData = (await response.json().catch(() => null)) as ApiErrorResponse | null
        throw new Error(errorData?.details || errorData?.error || "Failed to synchronize Steam data")
      }

      const data = (await response.json()) as SyncResultResponse
      await reload()
      invalidateSteamData()
      toast({
        title: "Steam sync completed",
        description: `${data.ownedGames} games, ${data.recentGames} recent, ${data.stats.totalAchievements} achievements indexed.`,
      })
    } catch (error) {
      console.error("Steam sync error:", error)
      toast({
        title: "Steam sync failed",
        description: error instanceof Error ? error.message : "The full synchronization could not be completed.",
        variant: "destructive",
      })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => void handleSync()}
      disabled={syncing}
      className="text-muted-foreground hover:text-foreground hover:bg-surface-3 gap-1.5"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
      <span className="hidden sm:inline">{syncing ? "Syncing..." : "Sync"}</span>
    </Button>
  )
}
