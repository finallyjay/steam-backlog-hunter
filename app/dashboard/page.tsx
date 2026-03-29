"use client"

import { useEffect } from "react"

import { useCurrentUser } from "@/hooks/use-current-user"
import { useRouter } from "next/navigation"
import { UserProfile } from "@/components/dashboard/user-profile"
import { RecentGames } from "@/components/dashboard/recent-games"
import { DashboardInsights } from "@/components/dashboard/dashboard-insights"
import { PageContainer } from "@/components/ui/page-container"
import { usePageTitle } from "@/components/ui/page-title-context"
import { LoadingMessage } from "@/components/ui/loading-message"
import { useSteamStats } from "@/hooks/use-steam-data"
import { useSyncStatus } from "@/components/dashboard/sync-status-button"

export default function DashboardPage() {
  const { user, loading } = useCurrentUser()
  const { stats, loading: statsLoading } = useSteamStats()
  const { label: syncLabel } = useSyncStatus()
  const router = useRouter()

  const { setTitle } = usePageTitle()
  useEffect(() => {
    setTitle("")
    return () => setTitle("")
  }, [setTitle])

  useEffect(() => {
    if (!loading && !user) {
      router.push("/")
    }
  }, [loading, router, user])

  if (loading) {
    return <LoadingMessage />
  }
  if (!user) {
    return null
  }

  return (
    <PageContainer>
      <h1 className="sr-only">Dashboard</h1>
      <div className="grid gap-8">
        <UserProfile user={user} stats={stats} statsLoading={statsLoading} syncLabel={syncLabel ?? "Not synced yet"} />
        <RecentGames />
        <DashboardInsights stats={stats} loading={statsLoading} />
      </div>
    </PageContainer>
  )
}
