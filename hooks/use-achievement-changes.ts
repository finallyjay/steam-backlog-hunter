"use client"

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react"

import { summarizeUnseenChanges } from "@/lib/achievement-changes-summary"
import type { AchievementChangesResponse, AchievementChangeView } from "@/lib/types/steam"

// Mirrors the event name in hooks/use-steam-data.ts. Duplicated on purpose:
// tests mock that module with a fixed export list and vitest throws on any
// export the factory doesn't define.
const STEAM_DATA_INVALIDATED_EVENT = "steam-data-invalidated"

type AchievementChangesState = {
  changes: AchievementChangeView[]
  loading: boolean
  error: string | null
  /** true once the first fetch settled (success or failure). */
  loaded: boolean
}

const INITIAL_STATE: AchievementChangesState = { changes: [], loading: true, error: null, loaded: false }

// Module-level store shared by every consumer (layout notifier, dashboard
// panel, library filter, detail banner) so one fetch serves them all and a
// "mark seen" in one place is reflected everywhere immediately.
const listeners = new Set<() => void>()
let state: AchievementChangesState = INITIAL_STATE
let inFlightRequest: Promise<void> | null = null

function emitState(next: AchievementChangesState) {
  state = next
  listeners.forEach((listener) => listener())
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange)
  return () => {
    listeners.delete(onStoreChange)
  }
}

function getSnapshot() {
  return state
}

function getServerSnapshot() {
  return INITIAL_STATE
}

/**
 * Loads the user's achievement changes into the shared store.
 *
 * Deduplicates concurrent callers and skips the request entirely once loaded
 * unless `force` is set (sync completion, visibility, manual refetch).
 */
export async function loadAchievementChanges(options?: { force?: boolean }): Promise<void> {
  if (inFlightRequest) return inFlightRequest
  if (!options?.force && state.loaded) return

  inFlightRequest = (async () => {
    let next: AchievementChangeView[] | null = null
    let errorMessage: string | null = null
    try {
      const response = await fetch("/api/steam/achievements/changes?limit=200", { cache: "no-store" })
      if (!response.ok) {
        throw new Error("Failed to fetch achievement changes")
      }
      const data = (await response.json()) as AchievementChangesResponse
      if (!Array.isArray(data.changes)) {
        throw new Error("Invalid achievement changes response")
      }
      next = data.changes
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : "Unknown error"
    } finally {
      inFlightRequest = null
    }
    if (next) {
      emitState({ changes: next, loading: false, error: null, loaded: true })
    } else {
      emitState({ ...state, loading: false, error: errorMessage, loaded: true })
    }
  })()

  return inFlightRequest
}

/**
 * Marks changes as seen, optimistically updating the store and rolling back
 * if the request fails.
 *
 * @param ids - Specific change ids; omit to acknowledge every unseen change
 * @returns true when the server accepted the update
 */
export async function markAchievementChangesSeen(ids?: number[]): Promise<boolean> {
  const previous = state
  const seenAt = new Date().toISOString()
  const targets = ids === undefined ? null : new Set(ids)
  emitState({
    ...state,
    changes: state.changes.map((change) =>
      !change.seenAt && (targets === null || targets.has(change.id)) ? { ...change, seenAt } : change,
    ),
  })

  try {
    const response = await fetch("/api/steam/achievements/changes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ids === undefined ? {} : { ids }),
    })
    if (!response.ok) {
      throw new Error("Failed to mark achievement changes as seen")
    }
    return true
  } catch {
    emitState(previous)
    return false
  }
}

/** Test-only: drops cached state so each test starts from a cold store. */
export function resetAchievementChangesStore() {
  inFlightRequest = null
  state = INITIAL_STATE
  listeners.forEach((listener) => listener())
}

/**
 * Subscribes to the user's achievement changes.
 *
 * Fetches once per session on first mount, refetches when a Steam sync
 * completes (`steam-data-invalidated`), and exposes the unseen subset plus a
 * per-game rollup for badges and filters.
 */
export function useAchievementChanges() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  useEffect(() => {
    void loadAchievementChanges()
  }, [])

  useEffect(() => {
    function handleInvalidate() {
      void loadAchievementChanges({ force: true })
    }
    window.addEventListener(STEAM_DATA_INVALIDATED_EVENT, handleInvalidate)
    return () => {
      window.removeEventListener(STEAM_DATA_INVALIDATED_EVENT, handleInvalidate)
    }
  }, [])

  const unseen = useMemo(() => snapshot.changes.filter((change) => !change.seenAt), [snapshot.changes])
  const byAppId = useMemo(() => summarizeUnseenChanges(snapshot.changes), [snapshot.changes])

  const markSeen = useCallback((ids?: number[]) => markAchievementChangesSeen(ids), [])
  const refetch = useCallback(() => loadAchievementChanges({ force: true }), [])

  return {
    changes: snapshot.changes,
    unseen,
    byAppId,
    loading: snapshot.loading,
    error: snapshot.error,
    markSeen,
    refetch,
  }
}
