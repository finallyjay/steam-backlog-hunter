"use client"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Gamepad2, LogOut } from "lucide-react"
import type { SteamUser } from "@/lib/auth"
import { useRouter } from "next/navigation"
import Link from "next/link"
import React from "react"
import { SyncStatusButton } from "@/components/dashboard/sync-status-button"

interface DashboardHeaderProps {
  user: SteamUser
}

export function DashboardHeader({ user }: DashboardHeaderProps) {
  const router = useRouter()

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" })
      router.push("/")
    } catch (error) {
      console.error("Logout error:", error)
    }
  }

  if (!user) {
    return null
  }

  return (
    <header className="border-surface-4 bg-background/70 sticky top-0 z-50 border-b backdrop-blur-xl">
      <div className="container mx-auto px-4 py-4 md:px-6 lg:px-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-accent/15 text-accent border-surface-4 flex h-11 w-11 items-center justify-center rounded-2xl border shadow-[0_0_30px_-14px_rgba(88,198,255,0.8)]">
              <Gamepad2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-accent/80 text-[0.7rem] font-semibold tracking-[0.32em] uppercase">Backlog hunter</p>
              <h1 className="text-xl font-semibold tracking-tight text-balance sm:text-2xl">Steam Backlog Hunter</h1>
            </div>
            <Badge
              variant="secondary"
              className="border-surface-4 bg-surface-2 ml-2 hidden border text-sm sm:inline-flex"
            >
              Personal build
            </Badge>
          </div>

          <nav aria-label="Main navigation" className="flex items-center gap-4">
            <SyncStatusButton />

            <Link href="/dashboard" className="flex items-center gap-3 hover:underline">
              <img
                src={user.avatar || "/placeholder.svg"}
                alt={`${user.displayName}'s Steam avatar`}
                className="border-accent/20 h-8 w-8 rounded-full border-2"
              />
              <span className="hidden font-medium sm:inline">{user.displayName}</span>
            </Link>

            <Button variant="outline" size="sm" onClick={handleLogout} className="gap-2 bg-transparent">
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Logout</span>
            </Button>
          </nav>
        </div>
      </div>
    </header>
  )
}
