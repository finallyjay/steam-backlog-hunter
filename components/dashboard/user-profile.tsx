import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ExternalLink, Calendar, MapPin } from "lucide-react"
import type { SteamUser } from "@/lib/auth"
import type { SteamStatsResponse } from "@/lib/types/steam"

interface UserProfileProps {
  user: SteamUser
  stats?: SteamStatsResponse | null
  statsLoading?: boolean
  statsUpdatedLabel?: string
}

export function UserProfile({ user, stats, statsLoading = false, statsUpdatedLabel }: UserProfileProps) {
  const summaryItems = [
    {
      label: "Total Games",
      value: statsLoading ? "..." : String(stats?.totalGames ?? 0),
    },
    {
      label: "Unlocked",
      value: statsLoading ? "..." : String(stats?.totalAchievements ?? 0),
    },
    {
      label: "Pending",
      value: statsLoading ? "..." : String(stats?.pendingAchievements ?? 0),
    },
    {
      label: "Perfect",
      value: statsLoading ? "..." : String(stats?.perfectGames ?? 0),
    },
  ]

  return (
    <Card className="overflow-hidden border-white/10 bg-[linear-gradient(135deg,rgba(88,198,255,0.14),transparent_35%),linear-gradient(180deg,rgba(255,255,255,0.04),transparent)]">
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center gap-4">
          <img
            src={user.avatar || "/placeholder.svg"}
            alt={user.displayName}
            className="h-14 w-14 rounded-2xl border border-white/10 shadow-lg"
          />
          <div className="space-y-1">
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.28em] text-accent/80">Operator profile</p>
            <h2 className="text-2xl font-semibold tracking-tight">{user.displayName}</h2>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent>
        <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary" className="gap-1 border border-white/10 bg-white/6 px-3 py-1.5">
                <Calendar className="h-3 w-3" />
                {user.timecreated
                  ? `Member since ${new Date(user.timecreated * 1000).getFullYear()}`
                  : "Member since ???"}
              </Badge>
              <Badge variant="secondary" className="gap-1 border border-white/10 bg-white/6 px-3 py-1.5">
                <MapPin className="h-3 w-3" />
                {(() => {
                  switch (user.personaState) {
                    case 0: return "Offline"
                    case 1: return "Online"
                    case 2: return "Busy"
                    case 3: return "Away"
                    case 4: return "Snooze"
                    case 5: return "Looking to trade"
                    case 6: return "Looking to play"
                    default: return "Unknown"
                  }
                })()}
              </Badge>
            </div>

            <div className="rounded-[1.25rem] border border-white/10 bg-slate-950/30 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-accent/80">At a glance</p>
                  <p className="text-sm text-muted-foreground">
                    {statsUpdatedLabel || "Stats will appear after the first sync."}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {summaryItems.map((item) => (
                  <div key={item.label} className="rounded-2xl border border-white/8 bg-white/5 px-3 py-3">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{item.label}</p>
                    <p className="mt-2 text-2xl font-semibold tracking-tight">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col justify-between gap-4 rounded-[1.25rem] border border-white/10 bg-slate-950/28 p-4">
            <div className="space-y-2">
              <p className="text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-accent/80">Profile actions</p>
              <p className="text-sm text-muted-foreground">
                Open your public Steam profile or switch tabs below to inspect recent activity, full library data, and completion targets.
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <Button variant="outline" size="sm" asChild className="border-white/10 bg-white/5 hover:bg-white/10">
                <a href={user.profileUrl} target="_blank" rel="noopener noreferrer" className="gap-2">
                  <ExternalLink className="h-4 w-4" />
                  View Steam Profile
                </a>
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
