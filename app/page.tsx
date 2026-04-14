"use client"

import { useEffect } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle, Trophy, BarChart3, Target } from "lucide-react"
import { useSearchParams, useRouter } from "next/navigation"
import { useCurrentUser } from "@/hooks/use-current-user"

// Hero illustration: three offset progress rings (90% / 60% / 25%) using
// the project's chart color tokens. Visualizes the app's purpose
// (achievement completion tracking) with the same palette users see on
// the dashboard donut/bar charts after sign-in.
//
// Stroke-dasharray math: dash = circumference * percent, gap = remainder.
// Circumference = 2 * π * r — values rounded.
function HeroOrbits() {
  return (
    <div className="relative mx-auto h-32 w-32">
      <div className="bg-accent/15 absolute inset-2 rounded-full blur-2xl" />
      <svg viewBox="0 0 200 200" className="relative h-32 w-32" aria-hidden="true">
        {/* Outer ring — chart-1 (cyan), 90% complete */}
        <circle cx="100" cy="100" r="78" fill="none" className="stroke-chart-1/20" strokeWidth="1.5" />
        <circle
          cx="100"
          cy="100"
          r="78"
          fill="none"
          className="stroke-chart-1"
          strokeWidth="2.5"
          strokeDasharray="441 49"
          strokeLinecap="round"
          transform="rotate(-90 100 100)"
        />

        {/* Mid ring — chart-2 (mint), 60%, slightly offset */}
        <circle cx="92" cy="105" r="58" fill="none" className="stroke-chart-2/20" strokeWidth="1.5" />
        <circle
          cx="92"
          cy="105"
          r="58"
          fill="none"
          className="stroke-chart-2"
          strokeWidth="2.5"
          strokeDasharray="219 146"
          strokeLinecap="round"
          transform="rotate(-30 92 105)"
        />

        {/* Inner ring — chart-3 (gold), 25%, more offset */}
        <circle cx="108" cy="92" r="38" fill="none" className="stroke-chart-3/20" strokeWidth="1.5" />
        <circle
          cx="108"
          cy="92"
          r="38"
          fill="none"
          className="stroke-chart-3"
          strokeWidth="2.5"
          strokeDasharray="60 179"
          strokeLinecap="round"
          transform="rotate(45 108 92)"
        />

        {/* Center pulsing dot */}
        <circle cx="100" cy="100" r="5" className="fill-accent animate-pulse" />
      </svg>
    </div>
  )
}

export default function HomePage() {
  const searchParams = useSearchParams()
  const error = searchParams.get("error")
  const { user, loading } = useCurrentUser()
  const router = useRouter()

  useEffect(() => {
    if (!loading && user && !error) {
      router.push("/dashboard")
    }
  }, [loading, user, error, router])

  const handleSteamSignIn = () => {
    window.location.href = "/api/auth/steam"
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-md space-y-10 text-center">
        <div className="space-y-6">
          <HeroOrbits />
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Steam Backlog Hunter</h1>
            <p className="text-muted-foreground mx-auto max-w-sm text-base">
              A personal dashboard to track your library, monitor achievements, and finish what you started.
            </p>
          </div>
        </div>

        {error && (
          <Alert variant="destructive" className="text-left">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {error === "auth_failed" && "Steam authentication failed. Please try again."}
              {error === "auth_error" && "An error occurred during authentication. Please try again."}
              {error === "not_whitelisted" && "Your Steam account is not authorized for this app."}
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-3">
          <button onClick={handleSteamSignIn} className="group cursor-pointer">
            <img
              src="/steam-signin.png"
              alt="Sign in with Steam"
              className="mx-auto transition-opacity group-hover:opacity-80"
            />
          </button>
          <p className="text-muted-foreground text-2xs">
            Authenticates via Steam OpenID. Only your public profile and game data are accessed.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="border-surface-4 bg-surface-1 space-y-2 rounded-lg border p-4">
            <Trophy className="text-accent mx-auto h-5 w-5" />
            <p className="text-foreground text-xs font-medium">Achievements</p>
            <p className="text-muted-foreground text-2xs leading-snug">Pending, unlocked, and completion per game.</p>
          </div>
          <div className="border-surface-4 bg-surface-1 space-y-2 rounded-lg border p-4">
            <BarChart3 className="text-accent mx-auto h-5 w-5" />
            <p className="text-foreground text-xs font-medium">Analytics</p>
            <p className="text-muted-foreground text-2xs leading-snug">Playtime, perfect games, and library stats.</p>
          </div>
          <div className="border-surface-4 bg-surface-1 space-y-2 rounded-lg border p-4">
            <Target className="text-accent mx-auto h-5 w-5" />
            <p className="text-foreground text-xs font-medium">Completion</p>
            <p className="text-muted-foreground text-2xs leading-snug">Games closest to 100% from recent play.</p>
          </div>
        </div>

        <p className="text-muted-foreground text-xs">Not affiliated with Valve Corporation.</p>
      </div>
    </div>
  )
}
