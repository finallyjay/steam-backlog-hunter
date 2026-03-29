"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Gamepad2, LayoutDashboard, Library, LogOut, Menu, X } from "lucide-react"
import type { SteamUser } from "@/lib/auth"
import { useRouter, usePathname } from "next/navigation"
import Link from "next/link"
import React from "react"
import { SyncStatusButton } from "@/components/dashboard/sync-status-button"

interface DashboardHeaderProps {
  user: SteamUser
}

function NavLink({
  href,
  icon: Icon,
  children,
  onClick,
}: {
  href: string
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
  onClick?: () => void
}) {
  const pathname = usePathname()
  const isActive = pathname === href

  return (
    <Link
      href={href}
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
        isActive
          ? "bg-accent text-accent-foreground font-medium"
          : "text-muted-foreground hover:bg-surface-3 hover:text-foreground"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </Link>
  )
}

export function DashboardHeader({ user }: DashboardHeaderProps) {
  const router = useRouter()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

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
    <>
      <header className="border-surface-4 bg-background/70 sticky top-0 z-50 border-b backdrop-blur-xl">
        <div className="container mx-auto px-4 py-3 md:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground sm:hidden"
                onClick={() => setMobileMenuOpen((prev) => !prev)}
                aria-expanded={mobileMenuOpen}
                aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              >
                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>

              <Link href="/dashboard" className="flex items-center gap-2.5 transition-opacity hover:opacity-80">
                <div className="bg-accent/15 text-accent border-surface-4 flex h-9 w-9 items-center justify-center rounded-xl border">
                  <Gamepad2 className="h-4.5 w-4.5" />
                </div>
                <span className="text-lg font-semibold tracking-tight">Steam Backlog Hunter</span>
              </Link>

              <nav aria-label="Main navigation" className="hidden items-center gap-4 sm:flex">
                <NavLink href="/dashboard" icon={LayoutDashboard}>
                  Dashboard
                </NavLink>
                <NavLink href="/games" icon={Library}>
                  Library
                </NavLink>
              </nav>
            </div>

            <div className="flex items-center gap-2">
              <SyncStatusButton />

              <img
                src={user.avatar || "/placeholder.svg"}
                alt={`${user.displayName}'s Steam avatar`}
                className="border-surface-4 h-7 w-7 rounded-full border"
              />
              <span className="text-foreground hidden text-sm font-medium sm:inline">{user.displayName}</span>

              <Button
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                className="text-muted-foreground hover:text-foreground hover:bg-surface-3 gap-1.5"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Logout</span>
              </Button>
            </div>
          </div>
        </div>
      </header>
      {mobileMenuOpen && (
        <div className="border-surface-4 bg-background/95 sticky top-[57px] z-50 border-b backdrop-blur-xl sm:hidden">
          <div className="container mx-auto flex flex-col gap-2 px-4 py-3">
            <NavLink href="/dashboard" icon={LayoutDashboard} onClick={() => setMobileMenuOpen(false)}>
              Dashboard
            </NavLink>
            <NavLink href="/games" icon={Library} onClick={() => setMobileMenuOpen(false)}>
              Library
            </NavLink>
          </div>
        </div>
      )}
    </>
  )
}
