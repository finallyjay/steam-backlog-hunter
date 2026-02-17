"use client"

import { useState, useEffect } from "react"
import { toast } from "@/hooks/use-toast"
import type { SteamUser } from "@/lib/auth"
import type { AuthMeResponse } from "@/lib/types/api"

export function useCurrentUser() {
  const [user, setUser] = useState<SteamUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchUser() {
      try {
        const res = await fetch("/api/auth/me")
        if (res.ok) {
          const data = (await res.json()) as AuthMeResponse
          setUser(data.user)
        } else if (res.status === 401) {
          setUser(null)
        } else if (res.status >= 500) {
          toast({
            title: "Authentication error",
            description: "Could not fetch user. Please sign in again.",
            variant: "destructive",
          })
        }
      } catch {
        toast({
          title: "Network error",
          description: "Could not connect to the authentication server.",
          variant: "destructive",
        })
      } finally {
        setLoading(false)
      }
    }
    void fetchUser()
  }, [])

  return { user, loading }
}
