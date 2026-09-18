"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Radar } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"

type DiscoveryStatusResponse = {
  running: boolean
  lastDiscoveryAt: string | null
}

type DiscoveryResultResponse = {
  discoveredAt: string
  added: number
  updated: number
  total: number
}

type ApiErrorResponse = {
  error?: string
}

// While a run started elsewhere (another tab, an earlier click before a
// reload) is in progress, poll the status endpoint at this cadence.
const RUNNING_POLL_MS = 5_000

// A status response can land after a POST result already set a newer
// timestamp; never let it move the label backwards.
function latestOf(a: string | null, b: string | null) {
  if (!a) return b
  if (!b) return a
  return Date.parse(b) > Date.parse(a) ? b : a
}

function formatLastDiscovery(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return `Last discovery ${date.toLocaleString()}`
}

/**
 * Manual trigger for the full extras discovery (`POST /api/steam/extras/discover`).
 * Shows the last completed run, spins while one is in progress, and calls
 * `onDiscovered` so the page can refetch its lists.
 */
export function DiscoverExtrasButton({ onDiscovered }: { onDiscovered?: () => void }) {
  const [running, setRunning] = useState(false)
  const [lastDiscoveryAt, setLastDiscoveryAt] = useState<string | null>(null)
  const { toast } = useToast()
  // Tracks a run observed via the status endpoint (not started by this
  // button) so we can refetch the lists once it finishes.
  const observedRunRef = useRef(false)

  const fetchStatus = useCallback(async (): Promise<DiscoveryStatusResponse | null> => {
    try {
      const response = await fetch("/api/steam/extras/discover", { cache: "no-store" })
      if (!response.ok) return null
      return (await response.json()) as DiscoveryStatusResponse
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    async function poll() {
      const status = await fetchStatus()
      if (cancelled) return
      if (status) {
        setLastDiscoveryAt((prev) => latestOf(prev, status.lastDiscoveryAt))
        if (status.running) {
          observedRunRef.current = true
          setRunning(true)
          timer = setTimeout(() => void poll(), RUNNING_POLL_MS)
          return
        }
        if (observedRunRef.current) {
          observedRunRef.current = false
          setRunning(false)
          onDiscovered?.()
        }
      }
    }

    void poll()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [fetchStatus, onDiscovered])

  async function handleDiscover() {
    try {
      setRunning(true)
      const response = await fetch("/api/steam/extras/discover", { method: "POST" })
      if (!response.ok) {
        const errorData = (await response.json().catch(() => null)) as ApiErrorResponse | null
        throw new Error(errorData?.error || "Failed to discover extras")
      }
      const data = (await response.json()) as DiscoveryResultResponse
      setLastDiscoveryAt(data.discoveredAt)
      onDiscovered?.()
      toast({
        title: "Extras discovery completed",
        description: `${data.added} new, ${data.updated} refreshed, ${data.total} extras in total.`,
      })
    } catch (error) {
      toast({
        title: "Extras discovery failed",
        description: error instanceof Error ? error.message : "The discovery could not be completed.",
        variant: "destructive",
      })
    } finally {
      setRunning(false)
    }
  }

  const label = formatLastDiscovery(lastDiscoveryAt)

  return (
    <div className="flex items-center gap-3">
      {label ? <span className="text-muted-foreground hidden text-xs sm:inline">{label}</span> : null}
      <Button
        variant="outline"
        size="sm"
        onClick={() => void handleDiscover()}
        disabled={running}
        aria-label="Discover extras"
        className="gap-1.5"
      >
        <Radar className={`h-3.5 w-3.5 ${running ? "animate-spin" : ""}`} />
        <span>{running ? "Discovering..." : "Discover extras"}</span>
      </Button>
    </div>
  )
}
