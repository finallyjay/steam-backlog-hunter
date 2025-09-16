"use client"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Gamepad2, LogOut } from "lucide-react"
import type { SteamUser } from "@/lib/auth"
import { useRouter } from "next/navigation"

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

  return (
    <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Gamepad2 className="h-8 w-8 text-accent" />
            <h1 className="text-2xl font-bold text-balance">Steam Tracker</h1>
            <Badge variant="secondary" className="text-sm ml-2">
              Beta
            </Badge>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <img
                src={user.avatar || "/placeholder.svg"}
                alt={user.displayName}
                className="w-8 h-8 rounded-full border-2 border-accent/20"
              />
              <span className="font-medium hidden sm:inline">{user.displayName}</span>
            </div>

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
