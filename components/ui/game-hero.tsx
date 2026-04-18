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
 *     - Steam's transparent logo.png is overlaid bottom-LEFT, horizontally
 *       aligned with the page container's content edge so it lines up
 *       with playtime / achievement progress rendered below — mirrors
 *       Steam's own library detail layout.
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
 * parallel and rendered as a heavily blurred, semi-transparent backdrop
 * fixed to the viewport (not scoped to the hero box) so the game's
 * ambient color bleeds into the whole page, not just the hero.
 *
 * Probing is entirely client-side so nothing hits the DB or sync
 * pipeline. Worst case is a ~300 ms flash during which a banner-shaped
 * skeleton is shown before the final layout resolves. We bet on the
 * banner skeleton because it matches the shape of most modern Steam
 * library entries; for old apps without banner+logo we take a one-frame
 * layout shift into the portrait layout.
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
  /** Plain-text name — used for img alt and the default `<h1>` fallback. */
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

  // Backdrop is fixed to the viewport (not absolute inside the hero box)
  // so the game's ambient color fills the whole detail page, including
  // the area below the banner that scrolls. `-z-10` keeps it behind
  // in-flow content; the body::before/::after CRT overlays stay above.
  const backdrop = bgOk ? (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
      <img
        src={`${CDN}/${appId}/page_bg_generated_v6b.jpg`}
        alt=""
        className="h-full w-full scale-110 object-cover opacity-40 blur-2xl brightness-75 saturate-150"
      />
      <div className="from-background/50 via-background/30 to-background/80 absolute inset-0 bg-gradient-to-b" />
    </div>
  ) : null

  // Banner-shaped skeleton during probing. Matches the final banner
  // layout so there's no visual jump when the banner resolves. For apps
  // that fall back to portrait we accept a one-frame shift.
  if (mode === "probing") {
    return (
      <div className="relative mb-8">
        {backdrop}
        <div className="relative left-1/2 -mt-8 -ml-[50vw] aspect-[3840/1240] w-screen overflow-hidden">
          <Skeleton className="h-full w-full rounded-none" />
        </div>
        <div className="mt-6 space-y-4">
          <Skeleton className="h-4 w-40" />
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
  // overlay uses an inner `container mx-auto px-4` so its left edge
  // lines up with the page content below (playtime, progress, buttons),
  // matching Steam's own library detail layout.
  const heroUrl = `${CDN}/${appId}/library_hero.jpg`
  const logoUrl = `${CDN}/${appId}/logo.png`
  return (
    <div className="relative mb-8">
      {backdrop}
      <div className="relative left-1/2 -mt-8 -ml-[50vw] aspect-[3840/1240] w-screen overflow-hidden">
        <img src={heroUrl} alt="" className="h-full w-full object-cover" />
        <div className="from-background/80 via-background/10 pointer-events-none absolute inset-0 bg-gradient-to-t to-transparent" />
        <div className="pointer-events-none absolute inset-0">
          <div className="container mx-auto flex h-full items-end px-4 pb-6 md:pb-10 lg:pb-14">
            <img
              src={logoUrl}
              alt={`${name} logo`}
              className="max-h-[50%] max-w-[50%] object-contain object-left-bottom drop-shadow-[0_4px_16px_rgba(0,0,0,0.6)]"
            />
          </div>
        </div>
      </div>
      <div className="mt-6 space-y-4">
        {title ?? <h1 className="text-2xl font-bold">{name}</h1>}
        {children}
      </div>
    </div>
  )
}
