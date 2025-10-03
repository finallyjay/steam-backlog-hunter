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
            title: "Error de autenticación",
            description: "No se pudo obtener el usuario. Por favor, inicia sesión de nuevo.",
            variant: "destructive"
          })
        }
      } catch (error) {
        console.log('[useCurrentUser] fetch error:', error)
        toast({
          title: "Error de red",
          description: "No se pudo conectar con el servidor de autenticación.",
          variant: "destructive"
        })
      }
      setLoading(false)
    }
    fetchUser()
  }, [])

  return { user, loading }
}