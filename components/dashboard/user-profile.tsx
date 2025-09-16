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
            <p className="text-muted-foreground text-sm">Steam ID: {user.steamId}</p>
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
              Member since 2024
            </Badge>
            <Badge variant="secondary" className="gap-1">
              <MapPin className="h-3 w-3" />
              Online
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
