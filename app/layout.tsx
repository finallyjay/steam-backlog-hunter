import ClientLayout from "./client-layout"
import { PageTitleProvider } from "@/components/ui/page-title-context"
import type { Metadata } from "next"
import { GeistSans } from "geist/font/sans"
import { GeistMono } from "geist/font/mono"
import "./globals.css"
// Removed unused client-only imports (they cause errors in server components)

export const metadata: Metadata = {
  title: "Steam Backlog Hunter",
  description: "Track your Steam backlog, monitor achievement progress, and hunt down completions.",
  metadataBase: new URL(process.env.NEXTAUTH_URL || "https://steam-backlog-hunter.tuckfow.com"),
  openGraph: {
    title: "Steam Backlog Hunter",
    description: "Track your Steam backlog, monitor achievement progress, and hunt down completions.",
    type: "website",
    url: "/",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Steam Backlog Hunter" }],
  },
  other: {
    "og:logo": "/icon.svg",
  },
  twitter: {
    card: "summary_large_image",
    title: "Steam Backlog Hunter",
    description: "Track your Steam backlog, monitor achievement progress, and hunt down completions.",
    images: ["/og-image.png"],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`dark font-sans ${GeistSans.variable} ${GeistMono.variable}`}>
        <PageTitleProvider>
          <ClientLayout>{children}</ClientLayout>
        </PageTitleProvider>
      </body>
    </html>
  )
}
