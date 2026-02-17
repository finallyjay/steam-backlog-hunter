import "server-only"

import { Redis } from "@upstash/redis"

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
  const token = process.env.REDIS_TOKEN

  if (!url || !token) {
    logRedisWarning("[cache] Redis not configured; falling back to direct Steam API fetches")
    redisClient = null
    return redisClient
  }

  redisClient = new Redis({ url, token })
  return redisClient
}
