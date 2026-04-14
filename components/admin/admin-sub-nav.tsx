"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Users, Tag } from "lucide-react"

const TABS = [
  { href: "/admin", label: "Users", icon: Users },
  { href: "/admin/orphan-names", label: "Orphan names", icon: Tag },
] as const

export function AdminSubNav() {
  const pathname = usePathname()
  return (
    <nav aria-label="Admin sections" className="border-surface-4 flex items-center gap-1 border-b pb-1">
      {TABS.map(({ href, label, icon: Icon }) => {
        const isActive = pathname === href
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
              isActive
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:bg-surface-3 hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
