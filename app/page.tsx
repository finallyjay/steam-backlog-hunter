"use client"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Gamepad2, AlertCircle, Trophy, BarChart3, Target } from "lucide-react"
import { useSearchParams } from "next/navigation"

export default function HomePage() {
  const searchParams = useSearchParams()
  const error = searchParams.get("error")

  const handleSteamSignIn = () => {
    window.location.href = "/api/auth/steam"
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-md space-y-10 text-center">
        <div className="space-y-5">
          <div className="bg-accent/15 text-accent border-surface-4 mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border shadow-[0_0_40px_-12px_rgba(88,198,255,0.5)]">
            <Gamepad2 className="h-7 w-7" />
          </div>
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
          <p className="text-muted-foreground text-[0.7rem]">
            Authenticates via Steam OpenID. Only your public profile and game data are accessed.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="border-surface-4 bg-surface-1 space-y-2 rounded-lg border p-4">
            <Trophy className="text-accent mx-auto h-5 w-5" />
            <p className="text-foreground text-xs font-medium">Achievements</p>
            <p className="text-muted-foreground text-[0.68rem] leading-snug">
              Pending, unlocked, and completion per game.
            </p>
          </div>
          <div className="border-surface-4 bg-surface-1 space-y-2 rounded-lg border p-4">
            <BarChart3 className="text-accent mx-auto h-5 w-5" />
            <p className="text-foreground text-xs font-medium">Analytics</p>
            <p className="text-muted-foreground text-[0.68rem] leading-snug">
              Playtime, perfect games, and library stats.
            </p>
          </div>
          <div className="border-surface-4 bg-surface-1 space-y-2 rounded-lg border p-4">
            <Target className="text-accent mx-auto h-5 w-5" />
            <p className="text-foreground text-xs font-medium">Completion</p>
            <p className="text-muted-foreground text-[0.68rem] leading-snug">Games closest to 100% from recent play.</p>
          </div>
        </div>

        <p className="text-muted-foreground text-xs">Not affiliated with Valve Corporation.</p>
      </div>
    </div>
  )
}
