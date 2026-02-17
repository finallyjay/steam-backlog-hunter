import "server-only"

import Redis from "ioredis"

let redisClient: Redis | null | undefined
let hasLoggedRedisWarning = false

function logRedisWarning(message: string) {
  if (hasLoggedRedisWarning) {
    return
  }

  hasLoggedRedisWarning = true
  console.warn(message)
}

export function getRedisClient(): Redis | null {
  if (redisClient !== undefined) {
    return redisClient
  }

  const url = process.env.REDIS_URL

  if (!url) {
    logRedisWarning("[cache] Redis not configured; falling back to direct Steam API fetches")
    redisClient = null
    return redisClient
  }

  redisClient = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableAutoPipelining: true,
  })

  redisClient.on("error", (error) => {
    console.error("[cache] Redis client error", error)
  })

  return redisClient
}
