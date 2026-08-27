import "server-only"

const UNKNOWN_IP = "unknown"

/**
 * Resolves the client IP address for rate-limiting and logging purposes.
 *
 * Deployment assumption: the app runs behind exactly one trusted reverse
 * proxy (e.g. Vercel's edge network). That proxy appends the connecting
 * client's address to the end of `x-forwarded-for` before forwarding the
 * request — every entry to the *left* of it was supplied by the client (or
 * an earlier untrusted hop) and can be freely spoofed. Taking the
 * *rightmost* entry — rather than the first, commonly-used-but-wrong
 * choice — is what makes this resistant to spoofing: a client can prepend
 * as many fake addresses as it wants, but it cannot control what the
 * trusted proxy appends after them. This is the same pattern applied in
 * personal-deck.
 *
 * Without a trusted proxy in front of the app (e.g. running the container
 * directly, exposed to the internet), `x-forwarded-for` is attacker
 * controlled end-to-end and this function's result cannot be trusted as a
 * real client identity — it will simply reflect whatever the client sent.
 * Deploy behind a trusted proxy that sets/overwrites this header, or behind
 * one that sets `x-real-ip`, for the result to be meaningful.
 *
 * Falls back to `x-real-ip` (a single-address header some proxies set),
 * then to the literal string "unknown" so callers always get a stable,
 * non-empty bucket key.
 *
 * @param headers - Request headers to read `x-forwarded-for` / `x-real-ip` from
 * @returns A normalized client IP (trimmed, no port suffix), or "unknown"
 */
export function getClientIp(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for")
  if (forwardedFor) {
    const entries = forwardedFor
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
    const rightmost = entries[entries.length - 1]
    if (rightmost) {
      return normalizeIp(rightmost)
    }
  }

  const realIp = headers.get("x-real-ip")?.trim()
  if (realIp) {
    return normalizeIp(realIp)
  }

  return UNKNOWN_IP
}

/**
 * Strips a trailing port from an IPv4 address or bracketed IPv6 literal.
 * Bare (unbracketed) IPv6 addresses are returned as-is since they contain
 * colons that are indistinguishable from a port separator.
 */
function normalizeIp(value: string): string {
  const trimmed = value.trim()

  // Bracketed IPv6, optionally with a port: "[::1]" or "[::1]:8080"
  const bracketedMatch = /^\[([^\]]+)\](?::\d+)?$/.exec(trimmed)
  if (bracketedMatch) {
    return bracketedMatch[1]
  }

  // IPv4, optionally with a port: "1.2.3.4" or "1.2.3.4:8080"
  const ipv4WithPortMatch = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(trimmed)
  if (ipv4WithPortMatch) {
    return ipv4WithPortMatch[1]
  }

  return trimmed
}
