import "server-only"

import { z } from "zod"
import { logger } from "@/lib/server/logger"

const envSchema = z
  .object({
    STEAM_API_KEY: z.string().min(1, "STEAM_API_KEY is required"),
    STEAM_WHITELIST_IDS: z.string().optional(),
    NEXTAUTH_URL: z.string().url().optional(),
    SQLITE_PATH: z.string().optional(),
    ADMIN_STEAM_ID: z.string().optional(),
    // HMAC key used to sign the session cookie. Required in production. In
    // development/test only, it falls back to STEAM_API_KEY (also a server
    // secret) so sessions are signed out of the box — see the superRefine
    // below, which enforces the production requirement.
    SESSION_SECRET: z.string().optional(),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  })
  .superRefine((data, ctx) => {
    // In production, falling back to STEAM_API_KEY means rotating that key
    // (e.g. after a leak) silently invalidates every signed-in session, and
    // means the session-signing secret and the Steam API credential are the
    // same value. Require a dedicated SESSION_SECRET in production; the
    // fallback stays for local dev/test convenience only.
    if (data.NODE_ENV === "production" && !data.SESSION_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SESSION_SECRET"],
        message:
          "SESSION_SECRET is required in production (falling back to STEAM_API_KEY would mean rotating the Steam API key silently invalidates every session).",
      })
    }
  })

let cached: z.infer<typeof envSchema> | null = null

function validateEnv() {
  if (cached) return cached

  const result = envSchema.safeParse(process.env)

  if (!result.success) {
    logger.error({ issues: result.error.issues }, "Environment variable validation failed")
    throw new Error("Invalid environment variables. See above for details.")
  }

  if (!result.data.SESSION_SECRET) {
    logger.warn(
      "SESSION_SECRET is not set; falling back to STEAM_API_KEY to sign sessions. This is only safe outside production.",
    )
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
