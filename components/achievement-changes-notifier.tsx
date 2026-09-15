"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"

import { ToastAction } from "@/components/ui/toast"
import { useAchievementChanges } from "@/hooks/use-achievement-changes"
import { useToast } from "@/hooks/use-toast"

const ANNOUNCED_STORAGE_KEY = "sbh:achievement-changes:announced"

function readAnnouncedIds(): Set<number> {
  try {
    const raw = window.sessionStorage.getItem(ANNOUNCED_STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is number => Number.isInteger(id)) : [])
  } catch {
    return new Set()
  }
}

function writeAnnouncedIds(ids: Set<number>) {
  try {
    window.sessionStorage.setItem(ANNOUNCED_STORAGE_KEY, JSON.stringify([...ids]))
  } catch {
    // Private mode / quota — fall back to the in-memory ref only.
  }
}

/**
 * Fires a toast when the user has unseen achievement changes that have not
 * been announced yet.
 *
 * Renders nothing. Mounted once in the client layout for authenticated pages.
 * Announced change ids are remembered in sessionStorage, so a reload, a
 * client navigation, or the user dismissing *one* change (which shrinks the
 * unseen set) never re-announces the rest. Only ids never announced before
 * (e.g. a new change after a sync) trigger a toast, and the toast describes
 * just those.
 */
export function AchievementChangesNotifier() {
  const { unseen, loading } = useAchievementChanges()
  const router = useRouter()
  const { toast } = useToast()
  const announcedRef = useRef<Set<number> | null>(null)

  useEffect(() => {
    if (loading || unseen.length === 0) return

    if (announcedRef.current === null) {
      announcedRef.current = readAnnouncedIds()
    }
    const announced = announcedRef.current
    const fresh = unseen.filter((change) => !announced.has(change.id))
    if (fresh.length === 0) return
    for (const change of fresh) announced.add(change.id)
    writeAnnouncedIds(announced)

    const gameCount = new Set(fresh.map((change) => change.appId)).size
    const added = fresh.reduce((sum, change) => sum + change.added.length, 0)
    const removed = fresh.reduce((sum, change) => sum + change.removed.length, 0)
    const lostPerfect = fresh.filter((change) => change.wasPerfect).length

    const parts: string[] = []
    if (added > 0) parts.push(`${added} new achievement${added === 1 ? "" : "s"}`)
    if (removed > 0) parts.push(`${removed} retired`)
    const summary = parts.join(", ")
    const games = `${gameCount} game${gameCount === 1 ? "" : "s"}`
    const perfectNote =
      lostPerfect > 0 ? ` ${lostPerfect} perfect game${lostPerfect === 1 ? " is" : "s are"} no longer 100%.` : ""

    toast({
      title: "Achievements changed",
      description: `${summary} across ${games}.${perfectNote}`,
      action: (
        <ToastAction
          altText="View games with new achievements"
          onClick={() => router.push("/games?filter=new-achievements")}
        >
          View
        </ToastAction>
      ),
    })
  }, [loading, unseen, toast, router])

  return null
}
