"use client"

import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Trophy, Gamepad2, TrendingUp, Users, AlertCircle } from "lucide-react"
import { useSearchParams } from "next/navigation"

export default function HomePage() {
  const searchParams = useSearchParams()
  const error = searchParams.get("error")

  const handleSteamSignIn = () => {
    window.location.href = "/api/auth/steam"
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted">
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Gamepad2 className="h-8 w-8 text-accent" />
              <h1 className="text-2xl font-bold text-balance">Steam Tracker</h1>
            </div>
            <Badge variant="secondary" className="text-sm">
              Beta
            </Badge>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="container mx-auto px-4 py-16">
        <div className="text-center space-y-8 max-w-4xl mx-auto">
          {error && (
            <Alert variant="destructive" className="max-w-md mx-auto">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {error === "auth_failed" && "Steam authentication failed. Please try again."}
                {error === "auth_error" && "An error occurred during authentication. Please try again."}
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
            <Button
              onClick={handleSteamSignIn}
              size="lg"
              className="bg-[#1b2838] hover:bg-[#2a475e] text-white border-0 px-8 py-6 text-lg font-semibold shadow-lg hover:shadow-xl transition-all duration-300 focus:ring-2 focus:ring-accent focus:ring-offset-2"
              style={{
                backgroundColor: "#1b2838",
                color: "#ffffff",
              }}
            >
              <img src="/steam-logo-white.jpg" alt="Steam" className="w-6 h-6 mr-3" />
              Sign in with Steam
            </Button>
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
            <h3 className="text-2xl font-semibold mb-6 text-center">What You'll Get</h3>
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

      {/* Footer */}
      <footer className="border-t bg-card/50 mt-16">
        <div className="container mx-auto px-4 py-8">
          <div className="text-center text-muted-foreground">
            <p>Built for gamers, by gamers. Not affiliated with Valve Corporation.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
