"use client"

import { useState } from "react"

/**
 * Shared Steam game image with a built-in fallback chain so nothing ever
 * renders as a broken icon. Used in two places:
 *
 * 1. `GameCard` lists — rendered twice per card (one portrait, one
 *    landscape) with `hidden sm:block` / `sm:hidden` so the right
 *    orientation shows per breakpoint.
 * 2. Game / extras detail pages — rendered once in the hero area with
 *    the caller's preferred orientation.
 *
 * The fallback chain walks through:
 *   landscape → primary (DB) → Steam header.jpg → legacy CDN → capsule_231x87 → local placeholder
 *   portrait  → primary (DB) → Steam library_600x900.jpg → local placeholder
 *
 * Each stage swaps via onError so genuinely broken URLs get replaced on
 * the fly without any network probing at render time.
 */

const LANDSCAPE_STAGES = ["primary", "header", "capsule_616", "legacy", "capsule_231", "placeholder"] as const
const PORTRAIT_STAGES = ["primary", "library_2x", "library", "placeholder"] as const

type LandscapeStage = (typeof LANDSCAPE_STAGES)[number]
type PortraitStage = (typeof PORTRAIT_STAGES)[number]

// `shared.fastly.steamstatic.com` is on the app's CSP img-src allowlist
// and serves every `store_item_assets/steam/apps/` asset we need. Other
// Valve CDNs (cloudflare, cdn.akamai) serve the same bytes but are
// blocked by CSP. The `steamcdn-a.akamaihd.net` legacy host is also
// allowed and keeps working for very old apps that predate the
// store_item_assets migration.
const FASTLY = "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps"
const LEGACY = "https://steamcdn-a.akamaihd.net/steam/apps"

function resolveLandscape(appId: number | string, stage: LandscapeStage, primary?: string | null): string {
  switch (stage) {
    case "primary":
      return primary || ""
    case "header":
      // 460×215 — the canonical Steam store header capsule.
      return `${FASTLY}/${appId}/header.jpg`
    case "capsule_616":
      // 616×353 — Steam's "main capsule" used in the store homepage
      // carousel. Higher resolution than header.jpg; useful when the
      // canonical header is missing for a delisted app but the main
      // capsule still exists on the CDN.
      return `${FASTLY}/${appId}/capsule_616x353.jpg`
    case "legacy":
      // Older Akamai CDN host — some very old apps only survive here
      // after Valve's CDN migrations.
      return `${LEGACY}/${appId}/header.jpg`
    case "capsule_231":
      // 231×87 — the oldest, smallest capsule format. Widest
      // compatibility with ancient/legacy apps.
      return `${FASTLY}/${appId}/capsule_231x87.jpg`
    case "placeholder":
      return "/placeholder-landscape.svg"
  }
}

function resolvePortrait(appId: number | string, stage: PortraitStage, primary?: string | null): string {
  switch (stage) {
    case "primary":
      return primary || ""
    case "library_2x":
      // 1200×1800 retina variant — sharper on Hi-DPI displays.
      return `${FASTLY}/${appId}/library_600x900_2x.jpg`
    case "library":
      // 600×900 standard variant — fallback when the 2x version is
      // missing (some delisted apps never had a retina asset).
      return `${FASTLY}/${appId}/library_600x900.jpg`
    case "placeholder":
      return "/placeholder-portrait.svg"
  }
}

interface GameImageProps {
  appId: number | string
  /** Primary cached URL from the DB (optional). Skipped if null/empty. */
  src?: string | null
  orientation: "landscape" | "portrait"
  alt: string
  className?: string
}

export function GameImage({ appId, src, orientation, alt, className }: GameImageProps) {
  // Start at stage 0 (primary) unless the caller didn't provide a src,
  // in which case we skip straight to the first CDN stage.
  const initialStage = src ? 0 : 1
  const [stageIndex, setStageIndex] = useState(initialStage)

  const stages = orientation === "landscape" ? LANDSCAPE_STAGES : PORTRAIT_STAGES
  const currentStage = stages[Math.min(stageIndex, stages.length - 1)]
  const currentUrl =
    orientation === "landscape"
      ? resolveLandscape(appId, currentStage as LandscapeStage, src)
      : resolvePortrait(appId, currentStage as PortraitStage, src)

  return (
    <img
      src={currentUrl}
      alt={alt}
      className={className}
      onError={() => setStageIndex((i) => Math.min(i + 1, stages.length - 1))}
    />
  )
}
