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
    <Card className="border-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <img
            src={user.avatar || "/placeholder.svg"}
            alt={user.displayName}
            className="w-12 h-12 rounded-full border-2 border-accent/20"
          />
          <div>
            <h2 className="text-2xl font-bold">{user.displayName}</h2>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent>
        <div className="flex flex-wrap gap-4 items-center">
          <Button variant="outline" size="sm" asChild>
            <a href={user.profileUrl} target="_blank" rel="noopener noreferrer" className="gap-2">
              <ExternalLink className="h-4 w-4" />
              View Steam Profile
            </a>
          </Button>

          <div className="flex gap-2">
            <Badge variant="secondary" className="gap-1">
              <Calendar className="h-3 w-3" />
              {user.timecreated
                ? `Member since ${new Date(user.timecreated * 1000).getFullYear()}`
                : "Member since ???"}
            </Badge>
            <Badge variant="secondary" className="gap-1">
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
        </div>
      </CardContent>
    </Card>
  )
}
