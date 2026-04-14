"use client"

import { useEffect, useState } from "react"

import { GameImage } from "@/components/ui/game-image"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Shared hero area for `/game/[id]` and `/extras/[id]`. Probes a few
 * Steam library assets client-side and renders one of two layouts
 * depending on what's available:
 *
 *   Layout A — banner hero (library_hero.jpg, 3840×1240)
 *     - If logo.png also loads, it's overlaid bottom-center Steam-style.
 *     - If logo.png is missing, the game name is rendered over a
 *       gradient at the bottom of the banner instead.
 *     - The caller's `children` (playtime, achievements bar, action
 *       buttons, etc.) are rendered below the banner in a content
 *       block.
 *
 *   Layout B — portrait fallback
 *     - Pixel-identical to the previous detail page markup: portrait
 *       thumbnail on the left (w-44, aspect 2:3), title + children on
 *       the right. Uses <GameImage> so the portrait chain (2x retina →
 *       1x → branded placeholder) still applies.
 *
 * On top of both layouts, `page_bg_generated_v6b.jpg` is probed in
 * parallel and rendered as a heavily blurred, semi-transparent
 * backdrop if it exists. Gives the card ambient color without ever
 * obscuring content (pointer-events-none, z-index below).
 *
 * Probing is entirely client-side so nothing hits the DB or sync
 * pipeline. Worst case is a ~300 ms flash during which the portrait
 * fallback is shown before the banner swaps in for apps that have a
 * library_hero.
 */

// Use `shared.fastly.steamstatic.com` because it is on the app's CSP
// img-src allowlist. Other hosts (cloudflare, akamai) serve the same
// assets but trigger CSP violations. The path prefix differs from the
// `/steam/apps/` pattern some scraper pages show — fastly wraps every
// asset under `/store_item_assets/`.
const CDN = "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps"

type HeroMode = "probing" | "banner-with-logo" | "banner-only" | "portrait"

function probeImage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(true)
    img.onerror = () => resolve(false)
    img.src = url
  })
}

interface GameHeroProps {
  appId: number | string
  /** Plain-text name — used for img alt and the Layout A banner title fallback when there's no logo. */
  name: string
  /**
   * Optional custom title node rendered in Layout B instead of the
   * default `<h1>{name}</h1>`. Lets callers compose the title with
   * extra elements (badges, status pills, etc.) without us having to
   * bake those into GameHero. Layout A still uses the plain `name`
   * for the banner — logo or gradient title — since wide banners and
   * inline badges look awkward together.
   */
  title?: React.ReactNode
  /** Portrait URL from the DB (optional). Passed through to GameImage. */
  portraitUrl?: string | null
  /** Content rendered below the title in both layouts. Do NOT include the h1 — GameHero renders it. */
  children: React.ReactNode
}

export function GameHero({ appId, name, title, portraitUrl, children }: GameHeroProps) {
  const [mode, setMode] = useState<HeroMode>("probing")
  const [bgOk, setBgOk] = useState(false)

  useEffect(() => {
    let cancelled = false
    setMode("probing")
    setBgOk(false)

    Promise.all([probeImage(`${CDN}/${appId}/library_hero.jpg`), probeImage(`${CDN}/${appId}/logo.png`)]).then(
      ([heroOk, logoOk]) => {
        if (cancelled) return
        if (heroOk && logoOk) setMode("banner-with-logo")
        else if (heroOk) setMode("banner-only")
        else setMode("portrait")
      },
    )

    probeImage(`${CDN}/${appId}/page_bg_generated_v6b.jpg`).then((ok) => {
      if (!cancelled) setBgOk(ok)
    })

    return () => {
      cancelled = true
    }
  }, [appId])

  const backdrop = bgOk ? (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-lg" aria-hidden="true">
      <img
        src={`${CDN}/${appId}/page_bg_generated_v6b.jpg`}
        alt=""
        className="h-full w-full scale-110 object-cover opacity-40 blur-2xl brightness-75 saturate-150"
      />
      <div className="from-background/50 via-background/30 to-background/80 absolute inset-0 bg-gradient-to-b" />
    </div>
  ) : null

  // While probing we render the Layout B skeleton so the page has
  // content immediately, then upgrade to the banner variant once the
  // library_hero probe resolves positively. Swap happens in ~200–500 ms.
  if (mode === "probing") {
    return (
      <div className="relative mb-8 flex items-start gap-6">
        {backdrop}
        <Skeleton className="aspect-[2/3] h-auto w-44 shrink-0 rounded-lg" />
        <div className="flex-1 space-y-4 pt-1">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-2 w-full" />
        </div>
      </div>
    )
  }

  if (mode === "portrait") {
    return (
      <div className="relative mb-8 flex items-start gap-6">
        {backdrop}
        <div className="border-surface-4 aspect-[2/3] w-44 shrink-0 overflow-hidden rounded-lg border">
          <GameImage
            appId={appId}
            src={portraitUrl}
            orientation="portrait"
            alt={`Cover art for ${name}`}
            className="h-full w-full object-cover"
          />
        </div>
        <div className="min-w-0 flex-1 space-y-4 pt-1">
          {title ?? <h1 className="text-2xl font-bold">{name}</h1>}
          {children}
        </div>
      </div>
    )
  }

  // Layout A — banner hero
  const heroUrl = `${CDN}/${appId}/library_hero.jpg`
  const logoUrl = `${CDN}/${appId}/logo.png`
  return (
    <div className="relative mb-8 overflow-hidden rounded-lg">
      {backdrop}
      <div className="border-surface-4 relative aspect-[3840/1240] overflow-hidden rounded-lg border">
        <img src={heroUrl} alt={`Hero art for ${name}`} className="absolute inset-0 h-full w-full object-cover" />
        {/* Bottom gradient anchors either the logo or the plain title
            so it stays legible regardless of the hero art. */}
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
        {mode === "banner-with-logo" ? (
          <img
            src={logoUrl}
            alt={name}
            className="absolute inset-x-0 bottom-4 mx-auto max-h-[40%] w-auto max-w-[55%] object-contain drop-shadow-2xl sm:bottom-6"
          />
        ) : (
          <h1 className="absolute inset-x-0 bottom-4 px-6 text-center text-2xl font-bold tracking-tight drop-shadow-lg sm:bottom-6 sm:text-3xl md:text-4xl">
            {name}
          </h1>
        )}
      </div>
      <div className="space-y-4 pt-6">{children}</div>
    </div>
  )
}
