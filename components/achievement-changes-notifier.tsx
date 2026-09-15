"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"

import { ToastAction } from "@/components/ui/toast"
import { useAchievementChanges } from "@/hooks/use-achievement-changes"
import { useToast } from "@/hooks/use-toast"

const ANNOUNCED_STORAGE_KEY = "sbh:achievement-changes:announced"

function readAnnouncedKey(): string | null {
  try {
    return window.sessionStorage.getItem(ANNOUNCED_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeAnnouncedKey(key: string) {
  try {
    window.sessionStorage.setItem(ANNOUNCED_STORAGE_KEY, key)
  } catch {
    // Private mode / quota — fall back to the in-memory ref only.
  }
}

/**
 * Fires a single toast when the user has unseen achievement changes.
 *
 * Renders nothing. Mounted once in the client layout for authenticated pages.
 * The set of unseen ids is remembered in sessionStorage so a page reload or
 * client navigation doesn't re-announce the same changes; a *new* change
 * (different id set) after a sync is announced again.
 */
export function AchievementChangesNotifier() {
  const { unseen, loading } = useAchievementChanges()
  const router = useRouter()
  const { toast } = useToast()
  const announcedKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (loading || unseen.length === 0) return

    const key = unseen
      .map((change) => change.id)
      .sort((a, b) => a - b)
      .join(",")
    if (announcedKeyRef.current === null) {
      announcedKeyRef.current = readAnnouncedKey()
    }
    if (announcedKeyRef.current === key) return
    announcedKeyRef.current = key
    writeAnnouncedKey(key)

    const gameCount = new Set(unseen.map((change) => change.appId)).size
    const added = unseen.reduce((sum, change) => sum + change.added.length, 0)
    const removed = unseen.reduce((sum, change) => sum + change.removed.length, 0)
    const lostPerfect = unseen.filter((change) => change.wasPerfect).length

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
