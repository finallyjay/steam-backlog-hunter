export interface SteamBadge {
  badgeid: number
  level: number
}

export interface SteamUser {
  steamId: string
  displayName: string
  avatar: string
  profileUrl: string
  timecreated?: number | null
  personaState?: number | null
  steamLevel?: number | null
  badges?: SteamBadge[] | null
}
