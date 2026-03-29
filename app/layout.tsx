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
  openGraph: {
    title: "Steam Backlog Hunter",
    description: "Track your Steam backlog, monitor achievement progress, and hunt down completions.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Steam Backlog Hunter",
    description: "Track your Steam backlog, monitor achievement progress, and hunt down completions.",
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
