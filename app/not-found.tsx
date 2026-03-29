import Link from "next/link"

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <h1 className="text-foreground text-7xl font-bold tracking-tight">404</h1>
      <p className="text-muted-foreground mt-4 text-lg">Page not found</p>
      <Link
        href="/dashboard"
        className="bg-surface-4 text-foreground hover:bg-surface-4/80 mt-8 inline-flex items-center rounded-lg px-6 py-3 text-sm font-medium transition-colors"
      >
        Back to Dashboard
      </Link>
    </div>
  )
}
