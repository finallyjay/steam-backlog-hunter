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

const LANDSCAPE_STAGES = ["primary", "header", "legacy", "capsule", "placeholder"] as const
const PORTRAIT_STAGES = ["primary", "library", "placeholder"] as const

type LandscapeStage = (typeof LANDSCAPE_STAGES)[number]
type PortraitStage = (typeof PORTRAIT_STAGES)[number]

function resolveLandscape(appId: number | string, stage: LandscapeStage, primary?: string | null): string {
  switch (stage) {
    case "primary":
      return primary || ""
    case "header":
      return `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`
    case "legacy":
      return `https://steamcdn-a.akamaihd.net/steam/apps/${appId}/header.jpg`
    case "capsule":
      return `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/capsule_231x87.jpg`
    case "placeholder":
      return "/placeholder-landscape.svg"
  }
}

function resolvePortrait(appId: number | string, stage: PortraitStage, primary?: string | null): string {
  switch (stage) {
    case "primary":
      return primary || ""
    case "library":
      return `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`
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
