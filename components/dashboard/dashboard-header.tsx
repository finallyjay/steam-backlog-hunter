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
    <header className="sticky top-0 z-50 border-b border-white/10 bg-slate-950/70 backdrop-blur-xl">
      <div className="container mx-auto px-4 py-4 md:px-6 lg:px-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-accent/15 text-accent shadow-[0_0_30px_-14px_rgba(88,198,255,0.8)]">
              <Gamepad2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[0.7rem] font-semibold uppercase tracking-[0.32em] text-accent/80">Achievement tracker</p>
              <h1 className="text-xl font-semibold tracking-tight text-balance sm:text-2xl">Steam Pending Achievements</h1>
            </div>
            <Badge variant="secondary" className="ml-2 hidden border border-white/10 bg-white/6 text-sm sm:inline-flex">
              Personal build
            </Badge>
          </div>

          <div className="flex items-center gap-4">
            <SyncStatusButton />

            <Link href="/dashboard" className="flex items-center gap-3 hover:underline">
              <img
                src={user.avatar || "/placeholder.svg"}
                alt={user.displayName}
                className="w-8 h-8 rounded-full border-2 border-accent/20"
              />
              <span className="font-medium hidden sm:inline">{user.displayName}</span>
            </Link>

            <Button variant="outline" size="sm" onClick={handleLogout} className="gap-2 bg-transparent">
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Logout</span>
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}
