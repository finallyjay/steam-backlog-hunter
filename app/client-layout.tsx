"use client"

import { useCallback, useEffect, useState } from "react"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { useCurrentUser } from "@/hooks/use-current-user"
import { usePathname } from "next/navigation"
import { Skeleton } from "@/components/ui/skeleton"
import { usePageTitle } from "@/components/ui/page-title-context"
import { Toaster } from "@/components/ui/toaster"
import { FirstSyncModal } from "@/components/first-sync-modal"

type SyncStatusResponse = {
  lastOwnedGamesSyncAt: string | null
  lastRecentGamesSyncAt: string | null
  lastStatsSyncAt: string | null
}

function useFirstSyncCheck(user: { steamId: string } | null) {
  const [needsSync, setNeedsSync] = useState(false)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    if (!user) {
      setChecked(true)
      return
    }
    let cancelled = false
    async function check() {
      try {
        const res = await fetch("/api/steam/sync", { cache: "no-store" })
        if (!res.ok || cancelled) return
        const data = (await res.json()) as SyncStatusResponse
        if (!data.lastOwnedGamesSyncAt) {
          setNeedsSync(true)
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setChecked(true)
      }
    }
    void check()
    return () => {
      cancelled = true
    }
  }, [user])

  const dismiss = useCallback(() => setNeedsSync(false), [])
  return { needsSync, checked, dismiss }
}

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { user, loading } = useCurrentUser()
  const { title } = usePageTitle()
  const { needsSync, checked, dismiss } = useFirstSyncCheck(user)
  const isAuthPage = pathname !== "/"

  return (
    <>
      <a
        href="#main-content"
        className="focus:ring-accent sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-md focus:bg-slate-900 focus:px-4 focus:py-2 focus:text-white focus:ring-2 focus:outline-none"
      >
        Skip to content
      </a>
      {isAuthPage && needsSync && checked && <FirstSyncModal onComplete={dismiss} />}
      {/* Show header on all pages except the root (login) */}
      {isAuthPage &&
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
      {/* tabIndex={-1} so the skip-to-content link can move keyboard focus
          here when activated (otherwise the focus ring stays on the link). */}
      <main id="main-content" tabIndex={-1} className="min-h-screen outline-none">
        {children}
      </main>
      <footer className="border-surface-4 border-t py-8">
        <div className="container mx-auto flex flex-col items-center gap-3 px-4 text-center">
          <p className="text-muted-foreground text-sm">
            Made with{" "}
            <span className="text-accent" aria-hidden="true">
              ❤
            </span>
            <span className="sr-only">love</span> by{" "}
            <a
              href="https://github.com/finallyjay"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground inline-flex items-center gap-1.5 underline underline-offset-4 transition-colors"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
              finallyjay
            </a>
          </p>
          <p className="text-muted-foreground/60 text-xs">
            v{process.env.NEXT_PUBLIC_APP_VERSION} · Not affiliated with Valve Corporation
          </p>
        </div>
      </footer>
      <Toaster />
    </>
  )
}
