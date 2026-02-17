import "server-only"

import { getRedisClient } from "@/lib/server/redis"

const CACHE_PREFIX = "sat:v1"

type CacheKeyType = "stats" | "games" | "ach" | "schema" | "unknown"

function getKeyType(key: string): CacheKeyType {
  const parts = key.split(":")
  if (parts.length < 3) {
    return "unknown"
  }

  const type = parts[2]
  if (type === "stats" || type === "games" || type === "ach" || type === "schema") {
    return type
  }

  return "unknown"
}

function redactToken(value: string) {
  if (value.length <= 4) {
    return "****"
  }

  return `***${value.slice(-4)}`
}

function redactKey(key: string) {
  const parts = key.split(":")
  return parts
    .map((part, index) => {
      if (index < 3) {
        return part
      }

      return redactToken(part)
    })
    .join(":")
}

function logCacheEvent(event: "cache_hit" | "cache_miss" | "cache_write" | "cache_error", key: string, error?: unknown) {
  const payload = {
    event,
    key_type: getKeyType(key),
    key: redactKey(key),
  }

  if (error) {
    console.error("[cache]", payload, error)
    return
  }

  console.info("[cache]", payload)
}

export function buildCacheKey(parts: string[]) {
  return [CACHE_PREFIX, ...parts].join(":")
}

export async function getJson<T>(key: string): Promise<T | null> {
  const redis = getRedisClient()
  if (!redis) {
    return null
  }

  try {
    const value = await redis.get<T>(key)

    if (value === null || value === undefined) {
      logCacheEvent("cache_miss", key)
      return null
    }

    logCacheEvent("cache_hit", key)
    return value
  } catch (error) {
    logCacheEvent("cache_error", key, error)
    return null
  }
}

export async function setJson<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  const redis = getRedisClient()
  if (!redis) {
    return
  }

  try {
    await redis.set(key, value, { ex: ttlSeconds })
    logCacheEvent("cache_write", key)
  } catch (error) {
    logCacheEvent("cache_error", key, error)
  }
}

export async function del(key: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) {
    return
  }

  try {
    await redis.del(key)
  } catch (error) {
    logCacheEvent("cache_error", key, error)
  }
}
