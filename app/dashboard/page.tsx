"use client"

import { useCurrentUser } from "@/hooks/use-current-user"
import { useRouter } from "next/navigation"
import { UserProfile } from "@/components/dashboard/user-profile"
import { StatsOverview } from "@/components/dashboard/stats-overview"
import { RecentGames } from "@/components/dashboard/recent-games"
import { AchievementProgress } from "@/components/dashboard/achievement-progress"
import { PageContainer } from "@/components/ui/page-container"
import { useEffect } from "react"
import { usePageTitle } from "@/components/ui/page-title-context"
import { LoadingMessage } from "@/components/ui/loading-message"

export default function DashboardPage() {
  const { user, loading } = useCurrentUser()
  const router = useRouter()

  const { setTitle } = usePageTitle()
  useEffect(() => {
    setTitle("")
  }, [setTitle])

  if (loading) {
    return <LoadingMessage />
  }
  if (!user) {
    router.push("/")
    return null
  }

  return (
    <PageContainer>
      <div className="grid gap-8">
        {/* User Profile Section */}
        {user ? <UserProfile user={user} /> : null}

        {/* Stats Overview */}
        <StatsOverview />

        {/* Main Content Grid */}
        <div className="grid lg:grid-cols-2 gap-8">
          <RecentGames />
          <AchievementProgress />
        </div>
      </div>
    </PageContainer>
  )
}
