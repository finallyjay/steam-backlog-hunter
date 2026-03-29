"use client"

import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { useCurrentUser } from "@/hooks/use-current-user"
import { usePathname } from "next/navigation"
import { Analytics } from "@vercel/analytics/next"
import { Skeleton } from "@/components/ui/skeleton"
import { usePageTitle } from "@/components/ui/page-title-context"
import { Toaster } from "@/components/ui/toaster"

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { user, loading } = useCurrentUser()
  const { title } = usePageTitle()

  return (
    <>
      <a
        href="#main-content"
        className="focus:ring-accent sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-md focus:bg-slate-900 focus:px-4 focus:py-2 focus:text-white focus:ring-2 focus:outline-none"
      >
        Skip to content
      </a>
      {/* Show header on all pages except the root (login) */}
      {pathname !== "/" &&
        (loading ? (
          <div className="bg-card/50 sticky top-0 z-40 border-b backdrop-blur-sm">
            <div className="container mx-auto px-4 py-4">
              <div className="flex items-center gap-2">
                <Skeleton className="h-8 w-8" />
                <Skeleton className="h-8 w-48" />
                <Skeleton className="ml-2 h-6 w-12" />
              </div>
            </div>
          </div>
        ) : (
          user && <DashboardHeader user={user} />
        ))}
      {title && <div className="w-full px-4 pt-7 pb-4 text-center text-3xl font-bold">{title}</div>}
      <main id="main-content" className="min-h-screen">
        {children}
      </main>
      <footer className="border-surface-4 border-t py-6">
        <div className="text-muted-foreground container mx-auto flex items-center justify-center gap-4 px-4 text-xs">
          <span>Steam Backlog Hunter v0.7.0</span>
          <span>·</span>
          <a
            href="https://github.com/finallyjay/steam-achievements-tracker"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            GitHub
          </a>
          <span>·</span>
          <span>Not affiliated with Valve Corporation</span>
        </div>
      </footer>
      <Toaster />
      <Analytics />
    </>
  )
}
