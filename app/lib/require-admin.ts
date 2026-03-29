import { getCurrentUser } from "@/app/lib/server-auth"
import { isAdmin } from "@/lib/server/admin"

/** Returns the user if they are admin, or null. */
export async function requireAdmin() {
  const user = await getCurrentUser()
  if (!user || !isAdmin(user.steamId)) {
    return null
  }
  return user
}
