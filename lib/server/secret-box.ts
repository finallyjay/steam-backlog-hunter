import "server-only"

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto"

import { env } from "@/lib/env"
import { logger } from "@/lib/server/logger"

// AES-256-GCM with a key derived from the app's session secret. Used for
// operator-entered secrets that must live in SQLite (webhook URLs, bot
// tokens) so a leaked database file alone doesn't expose them. Rotating
// SESSION_SECRET makes previously stored values undecryptable; they simply
// read back as "not configured" and must be re-entered in /admin.
const VERSION = "v1"
const IV_BYTES = 12
const KEY_BYTES = 32
// Fixed, app-specific salt: the input is a high-entropy server secret, not a
// user password, so a per-value salt buys nothing; scrypt is used so the
// derivation is deliberately expensive should the secret ever be weak.
const KDF_SALT = "steam-backlog-hunter:secret-box:v1"

let cachedKey: { material: string; key: Buffer } | null = null

function deriveKey(): Buffer {
  const material = env.SESSION_SECRET || env.STEAM_API_KEY
  if (cachedKey && cachedKey.material === material) return cachedKey.key
  const key = scryptSync(material, KDF_SALT, KEY_BYTES)
  cachedKey = { material, key }
  return key
}

/** Encrypts a UTF-8 string. Output is `v1:<iv>:<tag>:<ciphertext>` (base64url parts). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv("aes-256-gcm", deriveKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(":")
}

/**
 * Decrypts a value produced by `encryptSecret`. Returns `null` (and logs a
 * warning) when the value is malformed or was sealed under a different key.
 */
export function decryptSecret(sealed: string | null | undefined): string | null {
  if (!sealed) return null
  const parts = sealed.split(":")
  if (parts.length !== 4 || parts[0] !== VERSION) {
    logger.warn("secret-box: malformed sealed value")
    return null
  }
  try {
    const [, ivB64, tagB64, ctB64] = parts
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(), Buffer.from(ivB64, "base64url"))
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"))
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64url")), decipher.final()]).toString("utf8")
  } catch {
    logger.warn("secret-box: could not decrypt value (key rotated or data corrupted)")
    return null
  }
}
