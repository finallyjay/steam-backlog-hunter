import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { AnimatedNumber } from "@/components/ui/animated-number"
import { CompletionRing } from "@/components/ui/completion-ring"
import { surfaceCardVariants } from "@/components/ui/surface-card"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { AlertTriangle, ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"
import type { SteamUser } from "@/lib/auth"
import type { SteamStatsResponse } from "@/lib/types/steam"

const STEAM_LEVEL_CDN = "https://community.fastly.steamstatic.com/public/shared/images/community"
const SPRITE_FRAME = 32
const DISPLAY_SIZE = 36

/** Steam border colors by tier (0-9), used for levels 0-99 (no sprite). */
const TIER_COLORS = [
  "#9b9b9b",
  "#c02942",
  "#d95b43",
  "#fecc23",
  "#467a3c",
  "#4e8ddb",
  "#7652c9",
  "#c252c9",
  "#542437",
  "#997c52",
]

/** Sprite filenames by century (100+). Extracted from Steam's shared CSS. */
const CENTURY_SPRITES: Record<number, string> = {
  1: "levels_hexagons.png",
  2: "levels_shields.png",
  3: "levels_books.png",
  4: "levels_chevrons.png",
  5: "levels_circle2.png",
  6: "levels_angle.png",
  7: "levels_flag.png",
  8: "levels_wings.png",
  9: "levels_arrows.png",
  10: "levels_crystals.png",
  11: "levels_space.png",
  12: "levels_waterelement.png",
  13: "levels_fireelement.png",
  14: "levels_earthelement.png",
  15: "levels_airelement_1-2.png",
  16: "levels_airelement_3-4.png",
  17: "levels_airelement_5-6.png",
  18: "levels_airelement_7-8.png",
  19: "levels_airelement_9-10.png",
  20: "levels_geo_1-2.png?v=2",
  21: "levels_geo_3-4.png?v=2",
  22: "levels_geo_5-6.png?v=2",
  23: "levels_geo_7-8.png?v=2",
  24: "levels_geo_9-10.png?v=2",
  25: "levels_mandala_1-2.png?v=2",
  26: "levels_mandala_3-4.png?v=2",
  27: "levels_mandala_5-6.png?v=2",
  28: "levels_mandala_7-8.png?v=2",
  29: "levels_mandala_9-10.png?v=2",
  30: "levels_spiro_1-2.png?v=2",
  31: "levels_spiro_3-4.png?v=2",
  32: "levels_spiro_5-6.png?v=2",
  33: "levels_spiro_7-8.png?v=2",
  34: "levels_spiro_9-10.png?v=2",
  35: "levels_patterns_1-2.png?v=2",
  36: "levels_patterns_3-4.png?v=2",
  37: "levels_patterns_5-6.png?v=2",
  38: "levels_patterns_7-8.png?v=2",
  39: "levels_patterns_9-10.png?v=2",
  40: "levels_shapes_1.png?v=2",
  41: "levels_shapes_2.png?v=2",
  42: "levels_shapes_3.png?v=2",
  43: "levels_shapes_4.png?v=2",
  44: "levels_shapes_5.png?v=2",
  45: "levels_grunge_1.png?v=2",
  46: "levels_grunge_2.png?v=2",
  47: "levels_grunge_3.png?v=2",
  48: "levels_grunge_4.png?v=2",
  49: "levels_grunge_5.png?v=2",
  50: "levels_halftone_1.png?v=2",
  51: "levels_halftone_2.png?v=2",
  52: "levels_halftone_3.png?v=2",
  53: "levels_5300_dashes.png",
  54: "levels_5400_crosshatch.png",
  55: "levels_5500_spiral.png",
  56: "levels_5600_leaves.png",
  57: "levels_5700_mountain.png",
  58: "levels_5800_rain.png",
  59: "levels_5900_tornado.png",
  60: "levels_6000_snowflake.png",
  61: "levels_6100_crown.png",
}

function getSteamLevelBadge(level: number) {
  const tier = Math.floor(level / 10) % 10
  const century = Math.floor(level / 100)

  if (century === 0) {
    return { type: "circle" as const, borderColor: TIER_COLORS[tier] }
  }

  const sprite = CENTURY_SPRITES[century]
  if (!sprite) {
    return { type: "circle" as const, borderColor: TIER_COLORS[tier] }
  }

  const scale = DISPLAY_SIZE / SPRITE_FRAME
  return {
    type: "sprite" as const,
    url: `${STEAM_LEVEL_CDN}/${sprite}`,
    offset: tier * SPRITE_FRAME * scale,
  }
}

interface UserProfileProps {
  user: SteamUser
  stats?: SteamStatsResponse | null
  statsLoading?: boolean
  syncLabel?: string
}

const BADGE_CDN = "https://community.fastly.steamstatic.com/public/images/badges"

/** Game Collector badge tiers (badgeid 13). */
const GAME_COLLECTOR_TIERS = [1, 5, 10, 25, 50, 100, 250, 500, 1000]

function getBadgeTier(level: number, tiers: number[]): number {
  let tier = tiers[0]
  for (const t of tiers) {
    if (level >= t) tier = t
  }
  return tier
}

function getYearsOfService(timecreated?: number | null): number | null {
  if (!timecreated) return null
  const created = new Date(timecreated * 1000)
  const now = new Date()
  return Math.floor((now.getTime() - created.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
}

export function UserProfile({ user, stats, statsLoading = false, syncLabel }: UserProfileProps) {
  const yearsOfService = getYearsOfService(user.timecreated)

  const summaryItems = [
    {
      label: "Total Games",
      value: stats?.totalGames ?? 0,
      href: "/games",
    },
    {
      label: "Started Games",
      value: stats?.startedGames ?? 0,
      href: "/games?played=played&filter=started&achievements=with",
    },
    {
      label: "Perfect Games",
      value: stats?.perfectGames ?? 0,
      href: "/games?played=played&filter=perfect&achievements=with",
    },
    {
      label: "Unlocked Achievements",
      value: stats?.totalAchievements ?? 0,
      href: "/games?played=played&order=achievementsDesc&achievements=with",
    },
  ]

  return (
    <Card className="border-surface-4 overflow-hidden bg-[linear-gradient(135deg,rgba(88,198,255,0.14),transparent_35%),linear-gradient(180deg,rgba(255,255,255,0.04),transparent)]">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between">
          {/* as="div" because the inner <h2> for the display name is the
              real semantic heading. We don't want CardTitle defaulting to
              <h3> and creating a nested-heading conflict. */}
          <CardTitle as="div" className="flex items-start gap-4">
            <img
              src={user.avatar || "/placeholder.svg"}
              alt={`${user.displayName}'s Steam avatar`}
              className="border-surface-4 h-14 w-14 rounded-2xl border shadow-lg"
            />
            <div className="space-y-1.5">
              <div className="flex items-center gap-2.5">
                <h2 className="text-2xl font-semibold tracking-tight">{user.displayName}</h2>
                {user.steamLevel != null &&
                  (() => {
                    const badge = getSteamLevelBadge(user.steamLevel)
                    // text-[13px] below is locked to the Steam badge sprite's pixel grid
                    // (DISPLAY_SIZE/SPRITE_FRAME) — intentional pixel sizing, not drift.
                    if (badge.type === "circle") {
                      return (
                        <span
                          className="inline-flex items-center justify-center rounded-full text-[13px] font-bold text-white tabular-nums"
                          style={{
                            width: DISPLAY_SIZE,
                            height: DISPLAY_SIZE,
                            border: `2px solid ${badge.borderColor}`,
                          }}
                        >
                          {user.steamLevel}
                        </span>
                      )
                    }
                    return (
                      <span
                        className="relative inline-flex items-center justify-center text-[13px] font-bold text-white tabular-nums"
                        style={{ width: DISPLAY_SIZE, height: DISPLAY_SIZE, textShadow: "1px 1px #1a1a1a" }}
                      >
                        <span
                          className="absolute inset-0"
                          style={{
                            backgroundImage: `url(${badge.url})`,
                            backgroundPosition: `0 -${badge.offset}px`,
                            backgroundSize: `${DISPLAY_SIZE}px auto`,
                            backgroundRepeat: "no-repeat",
                          }}
                        />
                        <span className="relative">{user.steamLevel}</span>
                      </span>
                    )
                  })()}
              </div>
              <div className="flex items-center gap-2">
                {yearsOfService != null && user.timecreated && (
                  <Tooltip>
                    <TooltipTrigger
                      type="button"
                      className="focus-visible:ring-accent inline-flex rounded-md outline-none focus-visible:ring-2"
                    >
                      <img
                        src={`${BADGE_CDN}/02_years/steamyears${yearsOfService}_80.png`}
                        alt={`${yearsOfService} years of service`}
                        className="h-10 w-10"
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      Member since{" "}
                      {new Date(user.timecreated * 1000).toLocaleDateString("en-US", {
                        month: "long",
                        year: "numeric",
                      })}{" "}
                      · {yearsOfService} years of service
                    </TooltipContent>
                  </Tooltip>
                )}
                {(() => {
                  const collector = user.badges?.find((b) => b.badgeid === 13)
                  if (!collector) return null
                  const tier = getBadgeTier(collector.level, GAME_COLLECTOR_TIERS)
                  return (
                    <Tooltip>
                      <TooltipTrigger
                        type="button"
                        className="focus-visible:ring-accent inline-flex rounded-md outline-none focus-visible:ring-2"
                      >
                        <img
                          src={`${BADGE_CDN}/13_gamecollector/${tier}_80.png?v=4`}
                          alt={`Game Collector level ${collector.level}`}
                          className="h-10 w-10"
                        />
                      </TooltipTrigger>
                      <TooltipContent>Game Collector · {collector.level} games owned</TooltipContent>
                    </Tooltip>
                  )
                })()}
              </div>
            </div>
          </CardTitle>
          {!statsLoading && stats && <CompletionRing percent={stats.averageCompletion} />}
        </div>
      </CardHeader>

      {user.communityVisibilityState != null && user.communityVisibilityState !== 3 && (
        <div className="border-warning/30 bg-warning/10 mx-6 mb-2 flex items-start gap-3 rounded-lg border px-4 py-3">
          <AlertTriangle className="text-warning mt-0.5 h-4 w-4 shrink-0" />
          <div className="text-sm">
            <p role="alert" className="text-warning font-medium">
              Your Steam profile is not public
            </p>
            <p className="text-muted-foreground mt-0.5">
              Game and achievement data cannot be loaded unless your profile is public. Change your{" "}
              <a
                href="https://steamcommunity.com/my/edit/settings"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline underline-offset-2"
              >
                Steam privacy settings
              </a>{" "}
              to public, then sync again.
            </p>
          </div>
        </div>
      )}

      <CardContent>
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              asChild
              className="text-muted-foreground hover:text-foreground h-9 gap-2 px-3"
            >
              <a href={user.profileUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
                Steam profile
              </a>
            </Button>
            {syncLabel && <span className="text-muted-foreground text-sm">{syncLabel}</span>}
          </div>

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {summaryItems.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className={cn(surfaceCardVariants({ variant: "row", hover: "accent" }), "backdrop-blur-sm")}
              >
                <p className="text-muted-foreground text-2xs tracking-eyebrow font-semibold uppercase">{item.label}</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight">
                  {statsLoading ? "..." : <AnimatedNumber value={item.value} />}
                </p>
              </Link>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
