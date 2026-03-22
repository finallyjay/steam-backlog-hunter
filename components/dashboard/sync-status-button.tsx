"use client"

import { useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
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

function formatTimestamp(value: string | null) {
  if (!value) {
    return "Not synced yet"
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "Not synced yet"
  }

  return `Last sync ${date.toLocaleString()}`
}

export function SyncStatusButton() {
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [status, setStatus] = useState<SyncStatusResponse | null>(null)
  const { toast } = useToast()

  async function loadStatus() {
    try {
      setLoadingStatus(true)
      const response = await fetch("/api/steam/sync", { cache: "no-store" })
      if (!response.ok) {
        throw new Error("Failed to load sync status")
      }

      const data = (await response.json()) as SyncStatusResponse
      setStatus(data)
    } catch (error) {
      console.error("Sync status load error:", error)
    } finally {
      setLoadingStatus(false)
    }
  }

  useEffect(() => {
    void loadStatus()
  }, [])

  async function handleSync() {
    try {
      setSyncing(true)
      const response = await fetch("/api/steam/sync", {
        method: "POST",
      })

      if (!response.ok) {
        throw new Error("Failed to synchronize Steam data")
      }

      const data = (await response.json()) as SyncResultResponse
      await loadStatus()
      toast({
        title: "Steam sync completed",
        description: `${data.ownedGames} games, ${data.recentGames} recent, ${data.stats.totalAchievements} achievements indexed.`,
      })
    } catch (error) {
      console.error("Steam sync error:", error)
      toast({
        title: "Steam sync failed",
        description: "The full synchronization could not be completed.",
        variant: "destructive",
      })
    } finally {
      setSyncing(false)
    }
  }

  const label = status?.lastStatsSyncAt || status?.lastOwnedGamesSyncAt || status?.lastRecentGamesSyncAt || null

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        size="sm"
        onClick={() => void handleSync()}
        disabled={syncing}
        className="gap-2 bg-transparent"
      >
        <RefreshCw className={`h-4 w-4 ${(syncing || loadingStatus) ? "animate-spin" : ""}`} />
        <span className="hidden sm:inline">{syncing ? "Syncing..." : "Sync Steam"}</span>
      </Button>
      <p className="hidden text-xs text-muted-foreground sm:block">
        {loadingStatus ? "Loading sync status..." : formatTimestamp(label)}
      </p>
    </div>
  )
}
