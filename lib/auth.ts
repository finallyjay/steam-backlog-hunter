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
  communityVisibilityState?: number | null
  steamLevel?: number | null
  badges?: SteamBadge[] | null
  // Derived server-side on every getCurrentUser() call from
  // env.ADMIN_STEAM_ID, never stored in the session cookie. Keeps admin
  // changes from requiring users to re-login.
  isAdmin?: boolean
}
