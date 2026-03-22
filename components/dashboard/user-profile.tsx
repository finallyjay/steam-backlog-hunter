import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ExternalLink, Calendar, MapPin } from "lucide-react"
import type { SteamUser } from "@/lib/auth"

interface UserProfileProps {
  user: SteamUser
}

export function UserProfile({ user }: UserProfileProps) {
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
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
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

          <Button variant="outline" size="sm" asChild className="border-white/10 bg-white/5 hover:bg-white/10">
            <a href={user.profileUrl} target="_blank" rel="noopener noreferrer" className="gap-2">
              <ExternalLink className="h-4 w-4" />
              View Steam Profile
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
