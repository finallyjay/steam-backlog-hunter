import { getCurrentUser } from "@/lib/auth"
import { redirect } from "next/navigation"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { UserProfile } from "@/components/dashboard/user-profile"
import { StatsOverview } from "@/components/dashboard/stats-overview"
import { RecentGames } from "@/components/dashboard/recent-games"
import { AchievementProgress } from "@/components/dashboard/achievement-progress"

export default async function DashboardPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect("/")
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted">
      <DashboardHeader user={user} />

      <main className="container mx-auto px-4 py-8">
        <div className="grid gap-8">
          {/* User Profile Section */}
          <UserProfile user={user} />

          {/* Stats Overview */}
          <StatsOverview />

          {/* Main Content Grid */}
          <div className="grid lg:grid-cols-2 gap-8">
            <RecentGames />
            <AchievementProgress />
          </div>
        </div>
      </main>
    </div>
  )
}
