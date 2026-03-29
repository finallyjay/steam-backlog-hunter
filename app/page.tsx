"use client"

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Trophy, Gamepad2, TrendingUp, AlertCircle } from "lucide-react"
import { useSearchParams } from "next/navigation"
import { PageHeader } from "@/components/ui/page-header"
import { PageFooter } from "@/components/ui/page-footer"

export default function HomePage() {
  const searchParams = useSearchParams()
  const error = searchParams.get("error")

  const handleSteamSignIn = () => {
    window.location.href = "/api/auth/steam"
  }

  return (
    <div className="min-h-screen">
      <PageHeader title="Steam Backlog Hunter" icon={<Gamepad2 className="text-accent h-8 w-8" />}>
        <Badge variant="secondary" className="border-surface-4 bg-surface-2 border text-sm">
          Personal build
        </Badge>
      </PageHeader>

      <main className="container mx-auto px-4 py-12 md:px-6 lg:px-8">
        <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
          {error && (
            <Alert variant="destructive" className="max-w-md">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {error === "auth_failed" && "Steam authentication failed. Please try again."}
                {error === "auth_error" && "An error occurred during authentication. Please try again."}
                {error === "not_whitelisted" && "Your Steam account is not authorized for this app."}
              </AlertDescription>
            </Alert>
          )}

          <section className="space-y-8">
            <div className="space-y-5">
              <Badge
                variant="secondary"
                className="border-accent/25 bg-accent/10 text-accent border px-3 py-1 text-[0.72rem] tracking-[0.28em] uppercase"
              >
                Personal Steam cockpit
              </Badge>
              <div className="space-y-4">
                <h2 className="max-w-3xl text-5xl leading-none font-semibold tracking-tight text-balance sm:text-6xl">
                  Turn your backlog into a monitored campaign.
                </h2>
                <p className="text-muted-foreground max-w-2xl text-lg sm:text-xl">
                  A focused dashboard for one Steam library: what is unfinished, what is nearly done, and what deserves
                  the next session.
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Card className="border-surface-4 bg-surface-1 py-5">
                <CardHeader className="px-5">
                  <CardTitle className="text-muted-foreground text-sm tracking-[0.22em] uppercase">Signal</CardTitle>
                  <CardDescription className="text-foreground text-base">
                    Recent games, pending achievements, full-library stats.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card className="border-surface-4 bg-surface-1 py-5">
                <CardHeader className="px-5">
                  <CardTitle className="text-muted-foreground text-sm tracking-[0.22em] uppercase">Control</CardTitle>
                  <CardDescription className="text-foreground text-base">
                    Manual sync, cached snapshots, quick drill-down into each title.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card className="border-surface-4 bg-surface-1 py-5">
                <CardHeader className="px-5">
                  <CardTitle className="text-muted-foreground text-sm tracking-[0.22em] uppercase">Focus</CardTitle>
                  <CardDescription className="text-foreground text-base">
                    No social clutter, no marketplace noise, just completion progress.
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>
          </section>

          <section className="space-y-6">
            <div className="border-surface-4 rounded-[2rem] border bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02)),linear-gradient(135deg,rgba(88,198,255,0.18),transparent_45%)] p-6 shadow-[0_30px_80px_-45px_rgba(88,198,255,0.75)]">
              <div className="mb-6 flex items-start justify-between gap-6">
                <div>
                  <p className="text-accent/90 text-[0.72rem] font-semibold tracking-[0.28em] uppercase">
                    Steam access
                  </p>
                  <h3 className="mt-2 text-2xl font-semibold tracking-tight">Sign in and index your library</h3>
                </div>
                <div className="text-muted-foreground border-surface-4 bg-surface-3 rounded-full border px-3 py-1 text-xs tracking-[0.22em] uppercase">
                  OpenID
                </div>
              </div>

              <div className="mb-6 grid gap-4 sm:grid-cols-2">
                <div className="border-surface-4 rounded-2xl border bg-slate-950/35 p-4">
                  <p className="text-muted-foreground text-xs tracking-[0.18em] uppercase">What gets stored</p>
                  <p className="text-foreground/90 mt-2 text-sm">
                    Owned games, achievement snapshots, game schemas and library-wide stats in SQLite.
                  </p>
                </div>
                <div className="border-surface-4 rounded-2xl border bg-slate-950/35 p-4">
                  <p className="text-muted-foreground text-xs tracking-[0.18em] uppercase">Why it feels fast</p>
                  <p className="text-foreground/90 mt-2 text-sm">
                    The app serves cached snapshots instead of rebuilding the entire Steam state on every screen.
                  </p>
                </div>
              </div>

              <div className="flex justify-center sm:justify-start">
                <img
                  src="/steam-signin.png"
                  alt="Sign in with Steam"
                  className="cursor-pointer transition-transform duration-300 hover:scale-[1.02]"
                  onClick={handleSteamSignIn}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Card className="border-surface-4 bg-surface-1 py-5">
                <CardHeader className="px-5">
                  <div className="mb-3 flex items-center gap-3">
                    <div className="bg-accent/12 text-accent border-surface-4 rounded-2xl border p-3">
                      <Trophy className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">Achievement tracking</CardTitle>
                      <CardDescription>Pending, unlocked and complete states per game.</CardDescription>
                    </div>
                  </div>
                </CardHeader>
              </Card>
              <Card className="border-surface-4 bg-surface-1 py-5">
                <CardHeader className="px-5">
                  <div className="mb-3 flex items-center gap-3">
                    <div className="bg-accent/12 text-accent border-surface-4 rounded-2xl border p-3">
                      <TrendingUp className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">Library analytics</CardTitle>
                      <CardDescription>Playtime, perfect games and indexed totals in one view.</CardDescription>
                    </div>
                  </div>
                </CardHeader>
              </Card>
            </div>
          </section>
        </div>
      </main>

      <PageFooter />
    </div>
  )
}
