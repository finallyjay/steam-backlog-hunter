import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { AnimatedNumber } from "@/components/ui/animated-number"
import { ExternalLink, Calendar } from "lucide-react"
import type { SteamUser } from "@/lib/auth"
import type { SteamStatsResponse } from "@/lib/types/steam"

interface UserProfileProps {
  user: SteamUser
  stats?: SteamStatsResponse | null
  statsLoading?: boolean
  syncLabel?: string
  statsUpdatedLabel?: string
}

export function UserProfile({ user, stats, statsLoading = false, syncLabel, statsUpdatedLabel }: UserProfileProps) {
  const summaryItems = [
    {
      label: "Total Games",
      value: stats?.totalGames ?? 0,
    },
    {
      label: "Started Games",
      value: stats?.startedGames ?? 0,
    },
    {
      label: "Perfect Games",
      value: stats?.perfectGames ?? 0,
    },
    {
      label: "Unlocked Achievements",
      value: stats?.totalAchievements ?? 0,
    },
  ]

  return (
    <Card className="border-surface-4 overflow-hidden bg-[linear-gradient(135deg,rgba(88,198,255,0.14),transparent_35%),linear-gradient(180deg,rgba(255,255,255,0.04),transparent)]">
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-4">
            <img
              src={user.avatar || "/placeholder.svg"}
              alt={`${user.displayName}'s Steam avatar`}
              className="border-surface-4 h-14 w-14 rounded-2xl border shadow-lg"
            />
            <div className="space-y-1">
              <h2 className="text-2xl font-semibold tracking-tight">{user.displayName}</h2>
            </div>
          </CardTitle>
          {!statsLoading && stats && (
            <div className="text-right">
              <p className="text-muted-foreground text-[0.68rem] font-semibold tracking-[0.18em] uppercase">
                Avg. completion
              </p>
              <p className="mt-1 flex items-baseline justify-end text-3xl font-semibold tracking-tight">
                <AnimatedNumber value={stats.averageCompletion} />
                <span className="text-muted-foreground ml-1.5 self-center text-lg">%</span>
              </p>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent>
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="border-surface-4 bg-surface-2 gap-1 border px-3 py-1.5">
              <Calendar className="h-3 w-3" />
              {user.timecreated
                ? `Member since ${new Date(user.timecreated * 1000).getFullYear()}`
                : "Member since ???"}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              asChild
              className="text-muted-foreground hover:text-foreground h-9 gap-2 px-3"
            >
              <a href={user.profileUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
                Steam profile
              </a>
            </Button>
            <span className="text-muted-foreground text-sm">{syncLabel}</span>
            {statsUpdatedLabel && <span className="text-muted-foreground text-sm">&middot; {statsUpdatedLabel}</span>}
          </div>

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {summaryItems.map((item) => (
              <div
                key={item.label}
                className="border-surface-4 bg-surface-1 rounded-lg border px-4 py-4 backdrop-blur-sm"
              >
                <p className="text-muted-foreground text-[0.68rem] font-semibold tracking-[0.18em] uppercase">
                  {item.label}
                </p>
                <p className="mt-2 text-2xl font-semibold tracking-tight">
                  {statsLoading ? "..." : <AnimatedNumber value={item.value} />}
                </p>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
