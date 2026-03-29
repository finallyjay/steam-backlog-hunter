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
      <footer className="border-surface-4 border-t py-8">
        <div className="container mx-auto flex flex-col items-center gap-3 px-4 text-center">
          <p className="text-muted-foreground text-sm">
            Made with <span className="text-accent">❤</span> by{" "}
            <a
              href="https://github.com/finallyjay"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground underline underline-offset-4 transition-colors"
            >
              finallyjay
            </a>
          </p>
          <div className="text-muted-foreground flex items-center gap-3 text-xs">
            <a
              href="https://github.com/finallyjay/steam-achievements-tracker"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground flex items-center gap-1.5 transition-colors"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
              GitHub
            </a>
            <span>·</span>
            <span>v0.8.1</span>
            <span>·</span>
            <span className="text-muted-foreground/60">Not affiliated with Valve Corporation</span>
          </div>
        </div>
      </footer>
      <Toaster />
      <Analytics />
    </>
  )
}
