import "server-only"

// Barrel re-export: all public API from the split modules
// Existing imports like `import { ... } from "@/lib/server/steam-store"` continue to work.

export {
  getOwnedGamesForUser,
  getRecentlyPlayedGamesForUser,
  getStoredGameForUser,
} from "@/lib/server/steam-games-sync"

export { getBatchStoredAchievements, getAchievementsForGame } from "@/lib/server/steam-achievements-sync"

export { getStatsForUser, getUserSyncStatus, synchronizeUserData } from "@/lib/server/steam-stats-compute"
