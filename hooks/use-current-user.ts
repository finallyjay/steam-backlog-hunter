"use client"

import { useEffect, useSyncExternalStore } from "react"
import { toast } from "@/hooks/use-toast"
import type { SteamUser } from "@/lib/auth"
import type { AuthMeResponse } from "@/lib/types/api"

type CurrentUserState = {
  user: SteamUser | null
  loading: boolean
}

const listeners = new Set<() => void>()
let currentUserState: CurrentUserState = {
  user: null,
  loading: true,
}
let inFlightRequest: Promise<void> | null = null

function emitState(nextState: CurrentUserState) {
  currentUserState = nextState
  listeners.forEach((listener) => listener())
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange)
  return () => {
    listeners.delete(onStoreChange)
  }
}

const SERVER_SNAPSHOT: CurrentUserState = { user: null, loading: true }

function getSnapshot() {
  return currentUserState
}

function getServerSnapshot() {
  return SERVER_SNAPSHOT
}

async function ensureCurrentUserLoaded(): Promise<void> {
  if (inFlightRequest) {
    return inFlightRequest
  }

  inFlightRequest = (async () => {
    try {
      const res = await fetch("/api/auth/me")
      if (res.ok) {
        const data = (await res.json()) as AuthMeResponse
        emitState({ user: data.user, loading: false })
      } else if (res.status === 401) {
        emitState({ user: null, loading: false })
      } else if (res.status >= 500) {
        toast({
          title: "Authentication error",
          description: "Could not fetch user. Please sign in again.",
          variant: "destructive",
        })
        emitState({ ...currentUserState, loading: false })
      } else {
        emitState({ ...currentUserState, loading: false })
      }
    } catch {
      toast({
        title: "Network error",
        description: "Could not connect to the authentication server.",
        variant: "destructive",
      })
      emitState({ ...currentUserState, loading: false })
    } finally {
      inFlightRequest = null
    }
  })()

  return inFlightRequest
}

async function revalidateCurrentUser(): Promise<void> {
  inFlightRequest = null
  return ensureCurrentUserLoaded()
}

export function useCurrentUser() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  useEffect(() => {
    void ensureCurrentUserLoaded()
  }, [])

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void revalidateCurrentUser()
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [])

  return state
}
