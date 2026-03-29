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
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8 text-center">
        <div className="space-y-4">
          <div className="bg-accent/15 text-accent border-surface-4 mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border">
            <Gamepad2 className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Steam Backlog Hunter</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Track achievements, monitor progress, finish your backlog.
            </p>
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {error === "auth_failed" && "Steam authentication failed. Please try again."}
              {error === "auth_error" && "An error occurred during authentication. Please try again."}
              {error === "not_whitelisted" && "Your Steam account is not authorized for this app."}
            </AlertDescription>
          </Alert>
        )}

        <div className="border-surface-4 bg-surface-1 space-y-5 rounded-xl border p-6 backdrop-blur-sm">
          <div className="space-y-3">
            <div className="text-muted-foreground flex items-center justify-center gap-6 text-xs">
              <span className="flex items-center gap-1.5">
                <Trophy className="h-3.5 w-3.5" /> Achievements
              </span>
              <span className="flex items-center gap-1.5">
                <BarChart3 className="h-3.5 w-3.5" /> Analytics
              </span>
              <span className="flex items-center gap-1.5">
                <Target className="h-3.5 w-3.5" /> Completion
              </span>
            </div>
          </div>

          <button onClick={handleSteamSignIn} className="group w-full cursor-pointer">
            <img
              src="/steam-signin.png"
              alt="Sign in with Steam"
              className="mx-auto transition-opacity group-hover:opacity-80"
            />
          </button>

          <p className="text-muted-foreground text-[0.7rem]">
            Sign in via Steam OpenID. Only your public profile and game data are accessed.
          </p>
        </div>

        <p className="text-muted-foreground text-xs">Not affiliated with Valve Corporation.</p>
      </div>
    </div>
  )
}
