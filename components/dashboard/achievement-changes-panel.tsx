"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { ArrowRight, Bell, Check, CheckCheck } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { AchievementChangeChips } from "@/components/ui/achievement-change-chips"
import { Skeleton } from "@/components/ui/skeleton"
import { SurfaceCard } from "@/components/ui/surface-card"
import { useAchievementChanges } from "@/hooks/use-achievement-changes"
import type { AchievementChangeView } from "@/lib/types/steam"
import { cn } from "@/lib/utils"

const MAX_ROWS = 8

// Fixed locale so the string is identical wherever it renders. (The panel
// only mounts after a client fetch, so it never hydrates server markup, but
// a deterministic format keeps that true even if a consumer changes.)
const DETECTED_AT_FORMAT = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
  // detected_at is a UTC ISO timestamp; pin the calendar date to UTC so a
  // browser west of Greenwich doesn't show the previous day.
  timeZone: "UTC",
})

function formatDetectedAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return DETECTED_AT_FORMAT.format(date)
}

function ChangeRow({
  change,
  onDismiss,
  dismissing,
}: {
  change: AchievementChangeView
  onDismiss: (id: number) => void
  dismissing: boolean
}) {
  const isUnseen = !change.seenAt
  return (
    <SurfaceCard
      variant="row"
      hover="accent"
      className={cn("flex items-center gap-3", !isUnseen && "opacity-60")}
      data-testid={`achievement-change-${change.id}`}
    >
      <Link href={`/game/${change.appId}`} className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-semibold">{change.gameName}</span>
          <AchievementChangeChips
            added={change.added.length}
            removed={change.removed.length}
            wasPerfect={change.wasPerfect}
          />
        </span>
        <span className="text-muted-foreground text-xs">
          {change.totalBefore !== null
            ? `${change.totalBefore} → ${change.totalAfter} achievements`
            : `${change.totalAfter} achievements`}
          {" · "}
          {formatDetectedAt(change.detectedAt)}
        </span>
      </Link>
      {isUnseen ? (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground shrink-0"
          aria-label={`Mark ${change.gameName} change as seen`}
          onClick={() => onDismiss(change.id)}
          disabled={dismissing}
        >
          <Check className="h-4 w-4" />
        </Button>
      ) : null}
    </SurfaceCard>
  )
}

/**
 * Dashboard panel listing recently detected achievement changes.
 *
 * Shows a compact skeleton during the initial fetch so the sections below
 * don't jump when rows arrive, then renders nothing on error or when the
 * user has no recorded changes at all, so the dashboard stays clean until
 * there is something to say. Unseen rows come first and can be acknowledged
 * one by one or all at once; seen rows stay visible (dimmed) as a short
 * history.
 */
export function AchievementChangesPanel() {
  const { changes, unseen, loading, error, markSeen } = useAchievementChanges()
  const [busy, setBusy] = useState(false)

  const rows = useMemo(() => {
    const sorted = [...changes].sort((a, b) => {
      const aUnseen = a.seenAt ? 1 : 0
      const bUnseen = b.seenAt ? 1 : 0
      if (aUnseen !== bUnseen) return aUnseen - bUnseen
      return b.detectedAt.localeCompare(a.detectedAt)
    })
    return sorted.slice(0, MAX_ROWS)
  }, [changes])

  if (loading) {
    return (
      <Card className="border-surface-4" data-testid="achievement-changes-panel-skeleton" aria-busy="true">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Bell className="text-accent h-5 w-5" />
            Achievement changes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <SurfaceCard key={i} variant="row" className="flex items-center gap-3">
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
              </SurfaceCard>
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }
  if (error || changes.length === 0) return null

  const handleDismiss = async (id: number) => {
    setBusy(true)
    await markSeen([id])
    setBusy(false)
  }

  const handleMarkAll = async () => {
    setBusy(true)
    await markSeen()
    setBusy(false)
  }

  return (
    <Card className="border-surface-4" data-testid="achievement-changes-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Bell className="text-accent h-5 w-5" />
          Achievement changes
          {unseen.length > 0 ? (
            <span
              className="bg-accent/15 text-accent border-accent/40 rounded-full border px-2 py-0.5 text-xs font-medium"
              aria-label={`${unseen.length} unseen changes`}
            >
              {unseen.length}
            </span>
          ) : null}
        </CardTitle>
        {unseen.length > 0 ? (
          <CardAction>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground gap-1.5"
              aria-label="Mark all achievement changes as seen"
              onClick={handleMarkAll}
              disabled={busy}
            >
              <CheckCheck className="h-4 w-4" />
              <span className="hidden sm:inline">Mark all as seen</span>
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {rows.map((change) => (
            <ChangeRow key={change.id} change={change} onDismiss={handleDismiss} dismissing={busy} />
          ))}
          {unseen.length > 0 ? (
            <Link
              href="/games?filter=new-achievements"
              className="text-accent inline-flex items-center gap-1.5 text-sm underline-offset-4 hover:underline"
            >
              View in library
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
