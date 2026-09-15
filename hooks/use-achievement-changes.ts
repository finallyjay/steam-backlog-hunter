"use client"

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react"

import { useCurrentUser } from "@/hooks/use-current-user"
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
  /**
   * true once a fetch *succeeded*. A failed fetch leaves this false so the
   * next consumer mount (navigation, reload) retries instead of pinning the
   * error for the whole session.
   */
  loaded: boolean
  /** Steam ID the cached `changes` belong to; a different user resets the store. */
  forSteamId: string | null
}

const INITIAL_STATE: AchievementChangesState = {
  changes: [],
  loading: true,
  error: null,
  loaded: false,
  forSteamId: null,
}

// Module-level store shared by every consumer (layout notifier, dashboard
// panel, library filter, detail banner) so one fetch serves them all and a
// "mark seen" in one place is reflected everywhere immediately.
const listeners = new Set<() => void>()
let state: AchievementChangesState = INITIAL_STATE
let inFlightRequest: Promise<void> | null = null
let queuedReload: Promise<void> | null = null

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
 * Loads the given user's achievement changes into the shared store.
 *
 * Deduplicates concurrent callers and skips the request once loaded for the
 * same user unless `force` is set (sync completion, manual refetch). A
 * forced load requested while a request is active is queued to run once it
 * settles, so data invalidated mid-fetch is never missed. Switching users
 * discards the previous user's cache before fetching.
 */
export async function loadAchievementChanges(options: { steamId: string; force?: boolean }): Promise<void> {
  const { steamId } = options
  const userChanged = state.forSteamId !== null && state.forSteamId !== steamId
  const force = Boolean(options.force) || userChanged

  if (inFlightRequest) {
    if (!force) return inFlightRequest
    if (!queuedReload) {
      queuedReload = inFlightRequest.then(() => {
        queuedReload = null
        return loadAchievementChanges({ steamId, force: true })
      })
    }
    return queuedReload
  }
  if (!force && state.loaded) return

  if (userChanged) {
    emitState({ ...INITIAL_STATE, forSteamId: steamId })
  }

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
      emitState({ changes: next, loading: false, error: null, loaded: true, forSteamId: steamId })
    } else {
      emitState({ ...state, loading: false, error: errorMessage, loaded: false, forSteamId: steamId })
    }
  })()

  return inFlightRequest
}

/**
 * Marks changes as seen, optimistically updating the store. On failure only
 * the rows this call flipped are reverted (a concurrent acknowledgement's
 * optimistic values are left alone) and a forced reload reconciles the
 * store with the server.
 *
 * @param ids - Specific change ids; omit to acknowledge every unseen change
 * @returns true when the server accepted the update
 */
export async function markAchievementChangesSeen(ids?: number[]): Promise<boolean> {
  const seenAt = new Date().toISOString()
  const targets = ids === undefined ? null : new Set(ids)
  const flipped = new Set<number>()
  emitState({
    ...state,
    changes: state.changes.map((change) => {
      if (change.seenAt || (targets !== null && !targets.has(change.id))) return change
      flipped.add(change.id)
      return { ...change, seenAt }
    }),
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
    emitState({
      ...state,
      changes: state.changes.map((change) =>
        flipped.has(change.id) && change.seenAt === seenAt ? { ...change, seenAt: null } : change,
      ),
    })
    if (state.forSteamId) {
      void loadAchievementChanges({ steamId: state.forSteamId, force: true })
    }
    return false
  }
}

/** Drops cached state (logout, tests) so the next consumer starts cold. */
export function resetAchievementChangesStore() {
  inFlightRequest = null
  queuedReload = null
  emitState(INITIAL_STATE)
}

/**
 * Subscribes to the current user's achievement changes.
 *
 * Fetches once per session per user on first mount, refetches when a Steam
 * sync completes (`steam-data-invalidated`), resets when the authenticated
 * user changes or signs out, and exposes the unseen subset plus a per-game
 * rollup for badges and filters.
 */
export function useAchievementChanges() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const { user, loading: userLoading } = useCurrentUser()
  const steamId = user?.steamId ?? null

  useEffect(() => {
    if (steamId) {
      void loadAchievementChanges({ steamId })
    } else if (!userLoading && state.forSteamId !== null) {
      // Signed out: don't keep the previous account's records around.
      resetAchievementChangesStore()
    }
  }, [steamId, userLoading])

  useEffect(() => {
    if (!steamId) return
    function handleInvalidate() {
      void loadAchievementChanges({ steamId: steamId as string, force: true })
    }
    window.addEventListener(STEAM_DATA_INVALIDATED_EVENT, handleInvalidate)
    return () => {
      window.removeEventListener(STEAM_DATA_INVALIDATED_EVENT, handleInvalidate)
    }
  }, [steamId])

  const unseen = useMemo(() => snapshot.changes.filter((change) => !change.seenAt), [snapshot.changes])
  const byAppId = useMemo(() => summarizeUnseenChanges(snapshot.changes), [snapshot.changes])

  const markSeen = useCallback((ids?: number[]) => markAchievementChangesSeen(ids), [])
  const refetch = useCallback(
    () => (steamId ? loadAchievementChanges({ steamId, force: true }) : Promise.resolve()),
    [steamId],
  )

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
