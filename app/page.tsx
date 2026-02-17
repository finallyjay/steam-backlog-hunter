"use client"

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Trophy, Gamepad2, TrendingUp, Users, AlertCircle } from "lucide-react"
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
    <div className="min-h-screen bg-gradient-to-br from-background to-muted">
      <PageHeader title="Steam Pending Achievements" icon={<Gamepad2 className="h-8 w-8 text-accent" />}>
        <Badge variant="secondary" className="text-sm">Beta</Badge>
      </PageHeader>

      {/* Hero Section */}
      <main className="container mx-auto px-4 py-16">
        <div className="text-center space-y-8 max-w-4xl mx-auto">
          {error && (
            <Alert variant="destructive" className="max-w-md mx-auto">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {error === "auth_failed" && "Steam authentication failed. Please try again."}
                {error === "auth_error" && "An error occurred during authentication. Please try again."}
                {error === "not_whitelisted" && "Your Steam account is not authorized for this app."}
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-4">
            <h2 className="text-5xl font-bold text-balance bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">
              Track Your Steam Journey
            </h2>
            <p className="text-xl text-muted-foreground text-pretty max-w-2xl mx-auto">
              Monitor your achievements, discover your gaming patterns, and celebrate your progress across all your
              Steam games.
            </p>
          </div>

          {/* Steam Sign-in Button */}
          <div className="flex justify-center">
            <div className="flex justify-center">
              <img
                src="/steam-signin.png"
                alt="Sign in with Steam"
                className="cursor-pointer"
                onClick={handleSteamSignIn}
              />
            </div>
          </div>

          {/* Features Grid */}
          <div className="grid md:grid-cols-3 gap-6 mt-16">
            <Card className="border-2 hover:border-accent/50 transition-colors duration-300">
              <CardHeader className="text-center">
                <Trophy className="h-12 w-12 text-accent mx-auto mb-4" />
                <CardTitle className="text-xl">Achievement Tracking</CardTitle>
                <CardDescription>Monitor your progress across all games and celebrate every milestone</CardDescription>
              </CardHeader>
            </Card>

            <Card className="border-2 hover:border-accent/50 transition-colors duration-300">
              <CardHeader className="text-center">
                <TrendingUp className="h-12 w-12 text-accent mx-auto mb-4" />
                <CardTitle className="text-xl">Gaming Analytics</CardTitle>
                <CardDescription>Discover insights about your gaming habits and favorite genres</CardDescription>
              </CardHeader>
            </Card>

            <Card className="border-2 hover:border-accent/50 transition-colors duration-300">
              <CardHeader className="text-center">
                <Users className="h-12 w-12 text-accent mx-auto mb-4" />
                <CardTitle className="text-xl">Social Features</CardTitle>
                <CardDescription>Compare achievements with friends and join the gaming community</CardDescription>
              </CardHeader>
            </Card>
          </div>

          {/* Stats Preview */}
          <div className="mt-16 p-8 bg-card rounded-lg border">
            <h3 className="text-2xl font-semibold mb-6 text-center">What You&apos;ll Get</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div className="text-center">
                <div className="text-3xl font-bold text-accent">100%</div>
                <div className="text-sm text-muted-foreground">Achievement Progress</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-accent">24/7</div>
                <div className="text-sm text-muted-foreground">Real-time Tracking</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-accent">∞</div>
                <div className="text-sm text-muted-foreground">Games Supported</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-accent">Free</div>
                <div className="text-sm text-muted-foreground">Always & Forever</div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <PageFooter />
    </div>
  )
}
