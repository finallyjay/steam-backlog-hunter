"use client"

import { useEffect, useState } from "react"

import { GameImage } from "@/components/ui/game-image"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Shared hero area for `/game/[id]` and `/extras/[id]`. Probes a few
 * Steam library assets client-side and renders one of two layouts
 * depending on what's available:
 *
 *   Layout A — banner hero (library_hero.jpg + logo.png)
 *     - Full-bleed banner that escapes the page container's max-width
 *       via the `w-screen` + `left-1/2` + `-ml-[50vw]` pattern.
 *     - `-mt-8` negates the page's top padding so the banner sits
 *       flush against the sticky header with no gap.
 *     - Steam's transparent logo.png is overlaid bottom-center on top
 *       of a subtle bottom-up gradient for legibility.
 *     - Requires BOTH library_hero.jpg AND logo.png to exist — if
 *       either is missing we fall back to Layout B so we never render
 *       a bare banner without the game's wordmark.
 *
 *   Layout B — portrait fallback
 *     - Portrait thumbnail on the left (w-44, aspect 2:3), title +
 *       children on the right. Uses <GameImage> so the portrait chain
 *       (2x retina → 1x → branded placeholder) still applies.
 *
 * On top of both layouts, `page_bg_generated_v6b.jpg` is probed in
 * parallel and rendered as a heavily blurred, semi-transparent
 * backdrop if it exists. Gives the card ambient color without ever
 * obscuring content (pointer-events-none, z-index below).
 *
 * Probing is entirely client-side so nothing hits the DB or sync
 * pipeline. Worst case is a ~300 ms flash during which the portrait
 * skeleton is shown before the final layout resolves.
 */

// Use `shared.fastly.steamstatic.com` because it is on the app's CSP
// img-src allowlist. Other hosts (cloudflare, akamai) serve the same
// assets but trigger CSP violations. The path prefix differs from the
// `/steam/apps/` pattern some scraper pages show — fastly wraps every
// asset under `/store_item_assets/`.
const CDN = "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps"

type HeroMode = "probing" | "banner" | "portrait"

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
  /** Plain-text name — used for img alt and the sr-only h1 fallback. */
  name: string
  /**
   * Optional custom title node rendered instead of the default
   * `<h1>{name}</h1>`. Lets callers compose the title with extra
   * elements (badges, status pills, etc.) without us having to bake
   * those into GameHero. Rendered below the banner in Layout A and to
   * the right of the portrait in Layout B.
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
        setMode(heroOk && logoOk ? "banner" : "portrait")
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

  // Layout A — banner + logo. Full-bleed (w-screen + centered via
  // left-1/2 + -ml-[50vw]) so it escapes the page container's max-width
  // on 2K+ displays. -mt-8 sits it flush with the sticky header. Logo
  // overlays bottom-center with a bottom-up gradient for contrast.
  // An sr-only h1 (or caller-provided `title`) preserves the semantic
  // heading even though the logo image supplies the visible wordmark.
  const heroUrl = `${CDN}/${appId}/library_hero.jpg`
  const logoUrl = `${CDN}/${appId}/logo.png`
  return (
    <div className="relative mb-8">
      {backdrop}
      <div className="relative left-1/2 -mt-8 -ml-[50vw] aspect-[3840/1240] w-screen overflow-hidden">
        <img src={heroUrl} alt="" className="h-full w-full object-cover" />
        <div className="from-background/80 via-background/10 pointer-events-none absolute inset-0 bg-gradient-to-t to-transparent" />
        <div className="pointer-events-none absolute inset-0 flex items-end justify-center p-4 sm:p-8 md:p-12 lg:p-16">
          <img
            src={logoUrl}
            alt={`${name} logo`}
            className="max-h-[55%] max-w-[70%] object-contain drop-shadow-[0_4px_16px_rgba(0,0,0,0.6)]"
          />
        </div>
      </div>
      <div className="mt-6 space-y-4">
        {title ?? <h1 className="sr-only">{name}</h1>}
        {children}
      </div>
    </div>
  )
}
