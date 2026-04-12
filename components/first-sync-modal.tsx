"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, RefreshCw } from "lucide-react"
import { invalidateSteamData } from "@/hooks/use-steam-data"

type SyncStatusResponse = {
  lastOwnedGamesSyncAt: string | null
  lastRecentGamesSyncAt: string | null
  lastStatsSyncAt: string | null
}

const POLL_INTERVAL_MS = 8_000

type Phase = "starting" | "syncing" | "polling" | "done" | "error"

const PHASE_LABELS: Record<Phase, string> = {
  starting: "Preparing your library\u2026",
  syncing: "Syncing games and achievements\u2026",
  polling: "Almost there, finishing up\u2026",
  done: "All set!",
  error: "Something went wrong",
}

export function FirstSyncModal({ onComplete }: { onComplete: () => void }) {
  const [phase, setPhase] = useState<Phase>("starting")
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const pollUntilSynced = useCallback(async () => {
    setPhase("polling")
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
      try {
        const res = await fetch("/api/steam/sync", { cache: "no-store" })
        if (!res.ok) continue
        const data = (await res.json()) as SyncStatusResponse
        if (data.lastStatsSyncAt) {
          setPhase("done")
          invalidateSteamData()
          await new Promise((r) => setTimeout(r, 800))
          onComplete()
          return
        }
      } catch {
        // retry
      }
    }
    setPhase("error")
  }, [onComplete])

  useEffect(() => {
    const controller = new AbortController()
    abortRef.current = controller

    async function run() {
      setPhase("syncing")
      try {
        const res = await fetch("/api/steam/sync", {
          method: "POST",
          signal: controller.signal,
        })
        if (res.ok) {
          setPhase("done")
          invalidateSteamData()
          await new Promise((r) => setTimeout(r, 800))
          onComplete()
          return
        }
      } catch {
        if (controller.signal.aborted) return
      }
      await pollUntilSynced()
    }

    void run()
    return () => controller.abort()
  }, [onComplete, pollUntilSynced])

  useEffect(() => {
    startRef.current = Date.now()
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const minutes = Math.floor(elapsed / 60)
  const seconds = elapsed % 60
  const timeLabel = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="border-surface-4 bg-card mx-4 w-full max-w-md space-y-6 rounded-2xl border p-8 text-center shadow-2xl">
        <div className="flex justify-center">
          {phase === "done" ? (
            <div className="bg-success/15 text-success flex h-16 w-16 items-center justify-center rounded-full">
              <RefreshCw className="h-8 w-8" />
            </div>
          ) : phase === "error" ? (
            <div className="bg-danger/15 text-danger flex h-16 w-16 items-center justify-center rounded-full">
              <RefreshCw className="h-8 w-8" />
            </div>
          ) : (
            <div className="bg-accent/15 text-accent flex h-16 w-16 items-center justify-center rounded-full">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          )}
        </div>

        <div className="space-y-2">
          <h2 className="text-xl font-semibold tracking-tight">First-time sync</h2>
          <p className="text-muted-foreground text-sm">{PHASE_LABELS[phase]}</p>
        </div>

        {phase !== "done" && phase !== "error" && (
          <div className="space-y-3">
            <div className="bg-surface-2 h-1.5 overflow-hidden rounded-full">
              <div
                className="bg-accent h-full animate-pulse rounded-full transition-all duration-1000"
                style={{ width: "100%" }}
              />
            </div>
            <p className="text-muted-foreground/60 text-xs">
              {timeLabel} elapsed — large libraries may take a few minutes
            </p>
          </div>
        )}

        {phase === "error" && (
          <div className="space-y-3">
            <p className="text-muted-foreground text-sm">
              The sync is still running in the background. Try refreshing the page in a minute.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="bg-accent hover:bg-accent/90 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
            >
              Refresh page
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
