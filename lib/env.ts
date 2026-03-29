import "server-only"

import { z } from "zod"
import { logger } from "@/lib/server/logger"

const envSchema = z.object({
  STEAM_API_KEY: z.string().min(1, "STEAM_API_KEY is required"),
  STEAM_WHITELIST_IDS: z.string().optional(),
  NEXTAUTH_URL: z.string().url().optional(),
  SQLITE_PATH: z.string().optional(),
  ADMIN_STEAM_ID: z.string().optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
})

let cached: z.infer<typeof envSchema> | null = null

function validateEnv() {
  if (cached) return cached

  const result = envSchema.safeParse(process.env)

  if (!result.success) {
    logger.error({ issues: result.error.issues }, "Environment variable validation failed")
    throw new Error("Invalid environment variables. See above for details.")
  }

  cached = result.data
  return cached
}

/** Validated environment variables, parsed and cached on first access. */
export const env = new Proxy({} as z.infer<typeof envSchema>, {
  get(_, prop: string) {
    return validateEnv()[prop as keyof z.infer<typeof envSchema>]
  },
})
