import "server-only"

import { getSqliteDatabase } from "@/lib/server/sqlite"

const IMAGES_STALE_MS = 30 * 24 * 60 * 60 * 1000
const IMAGES_BATCH_SIZE = 10

type GameImageRow = {
  appid: number
  icon_hash: string | null
  image_icon_url: string | null
  image_landscape_url: string | null
  image_portrait_url: string | null
  images_synced_at: string | null
}

function isStale(value: string | null | undefined, maxAgeMs: number) {
  if (!value) return true
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return true
  return Date.now() - timestamp > maxAgeMs
}

async function probeImageUrl(urls: string[]): Promise<string | null> {
  for (const url of urls) {
    try {
      const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000) })
      if (response.ok) {
        return url
      }
    } catch {
      // Skip failures
    }
  }
  return null
}

function getLandscapeCandidates(appId: number): string[] {
  return [
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
    `https://steamcdn-a.akamaihd.net/steam/apps/${appId}/header.jpg`,
  ]
}

function getPortraitCandidates(appId: number): string[] {
  return [
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/portrait.png`,
  ]
}

function getIconCandidates(appId: number, iconHash: string | null): string[] {
  const candidates: string[] = []
  if (iconHash) {
    candidates.push(`https://media.steampowered.com/steamcommunity/public/images/apps/${appId}/${iconHash}.jpg`)
  }
  candidates.push(`https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/capsule_231x87.jpg`)
  return candidates
}

type StoreAppDetails = {
  success?: boolean
  data?: {
    header_image?: string
    capsule_image?: string
  }
}

async function fetchStoreImages(appId: number): Promise<{ landscape: string | null; portrait: string | null }> {
  try {
    const response = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}`, {
      cache: "no-store",
    })
    if (!response.ok) return { landscape: null, portrait: null }

    const data = (await response.json()) as Record<string, StoreAppDetails>
    const payload = data[String(appId)]
    if (!payload?.success || !payload.data) return { landscape: null, portrait: null }

    return {
      landscape: payload.data.header_image || null,
      portrait: payload.data.capsule_image || null,
    }
  } catch {
    return { landscape: null, portrait: null }
  }
}

async function probeGameImages(appId: number, iconHash: string | null) {
  const [landscape, portrait, icon] = await Promise.all([
    probeImageUrl(getLandscapeCandidates(appId)),
    probeImageUrl(getPortraitCandidates(appId)),
    probeImageUrl(getIconCandidates(appId, iconHash)),
  ])

  // If HEAD probes missed landscape or portrait, try the Store API as a last resort
  if (!landscape || !portrait) {
    const storeImages = await fetchStoreImages(appId)
    return {
      landscape: landscape || storeImages.landscape,
      portrait: portrait || storeImages.portrait,
      icon,
    }
  }

  return { landscape, portrait, icon }
}

function getGamesMissingImages(appIds: number[]): GameImageRow[] {
  if (appIds.length === 0) return []

  const db = getSqliteDatabase()
  const rows = db
    .prepare(
      `
    SELECT appid, icon_hash, image_icon_url, image_landscape_url, image_portrait_url, images_synced_at
    FROM games
    WHERE appid IN (${appIds.map(() => "?").join(",")})
  `,
    )
    .all(...appIds) as GameImageRow[]

  return rows.filter(
    (row) =>
      !row.image_landscape_url ||
      !row.image_portrait_url ||
      !row.image_icon_url ||
      isStale(row.images_synced_at, IMAGES_STALE_MS),
  )
}

function persistGameImages(
  appId: number,
  images: { landscape: string | null; portrait: string | null; icon: string | null },
) {
  const db = getSqliteDatabase()
  const now = new Date().toISOString()

  db.prepare(
    `
    UPDATE games
    SET
      image_landscape_url = COALESCE(?, image_landscape_url),
      image_portrait_url = COALESCE(?, image_portrait_url),
      image_icon_url = COALESCE(?, image_icon_url),
      images_synced_at = ?,
      updated_at = ?
    WHERE appid = ?
  `,
  ).run(images.landscape, images.portrait, images.icon, now, now, appId)
}

/** Probes and persists missing game images (icon, landscape, portrait) for the given app IDs. */
export async function ensureGameImages(appIds: number[]) {
  const missing = getGamesMissingImages(appIds)
  if (missing.length === 0) return

  for (let i = 0; i < missing.length; i += IMAGES_BATCH_SIZE) {
    const batch = missing.slice(i, i + IMAGES_BATCH_SIZE)

    await Promise.all(
      batch.map(async (row) => {
        const images = await probeGameImages(row.appid, row.icon_hash)
        persistGameImages(row.appid, images)
      }),
    )
  }
}
