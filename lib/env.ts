import "server-only"

import { z } from "zod"
import { logger } from "@/lib/server/logger"

const envSchema = z.object({
  STEAM_API_KEY: z.string().min(1, "STEAM_API_KEY is required"),
  STEAM_WHITELIST_IDS: z.string().optional(),
  NEXTAUTH_URL: z.string().url().optional(),
  SQLITE_PATH: z.string().optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
})

function validateEnv() {
  const result = envSchema.safeParse(process.env)

  if (!result.success) {
    logger.error({ issues: result.error.issues }, "Environment variable validation failed")
    throw new Error("Invalid environment variables. See above for details.")
  }

  return result.data
}

export const env = validateEnv()
