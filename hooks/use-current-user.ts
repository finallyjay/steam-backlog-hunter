"use client"

import { useState, useEffect } from "react"
import { toast } from "@/hooks/use-toast"

export function useCurrentUser() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchUser() {
      console.log('[useCurrentUser] fetching /api/auth/me...')
      try {
        const res = await fetch("/api/auth/me")
        if (res.ok) {
          const data = await res.json()
          setUser(data.user)
          console.log('[useCurrentUser] user:', data.user)
        } else {
          console.log('[useCurrentUser] response not ok:', res.status)
          toast({
            title: "Authentication error",
            description: "Could not fetch user. Please sign in again.",
            variant: "destructive"
          })
        }
      } catch (error) {
        console.log('[useCurrentUser] fetch error:', error)
        toast({
          title: "Network error",
          description: "Could not connect to the authentication server.",
          variant: "destructive"
        })
      }
      setLoading(false)
    }
    fetchUser()
  }, [])

  return { user, loading }
}