"use client"

import { useState, useEffect } from "react"
import { toast } from "@/hooks/use-toast"
import type { SteamUser } from "@/lib/auth"
import type { AuthMeResponse } from "@/lib/types/api"

type CurrentUserState = {
  user: SteamUser | null
  loading: boolean
}

const listeners = new Set<(state: CurrentUserState) => void>()
let currentUserState: CurrentUserState = {
  user: null,
  loading: true,
}
let inFlightRequest: Promise<void> | null = null

function emitState(nextState: CurrentUserState) {
  currentUserState = nextState
  listeners.forEach((listener) => listener(nextState))
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

export function useCurrentUser() {
  const [state, setState] = useState<CurrentUserState>({
    user: null,
    loading: true,
  })

  useEffect(() => {
    listeners.add(setState)
    setState(currentUserState)
    void ensureCurrentUserLoaded()
    return () => {
      listeners.delete(setState)
    }
  }, [])

  return state
}
