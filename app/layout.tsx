import ClientLayout from "./client-layout"
import { PageTitleProvider } from "@/components/ui/page-title-context"
import type { Metadata } from "next"
import { VT323, Space_Mono } from "next/font/google"
import "./globals.css"

// PHASE C LOCAL SPIKE — retro arcade / CRT theme.
// Space Mono becomes the body default (wired through --font-sans and --font-mono
// so every shadcn component and body text inherits it). VT323 is a display face
// reserved for headings, exposed as --font-display and applied in globals.css
// via an @layer base rule on h1/h2/h3.
const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-space-mono",
  display: "swap",
})

const vt323 = VT323({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-vt323",
  display: "swap",
})

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
      <body className={`dark font-sans ${vt323.variable} ${spaceMono.variable}`}>
        <PageTitleProvider>
          <ClientLayout>{children}</ClientLayout>
        </PageTitleProvider>
      </body>
    </html>
  )
}
