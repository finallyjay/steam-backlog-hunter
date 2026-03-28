"use client"

import { BarChart3, Crosshair, Library, Play } from "lucide-react"

import { Button } from "@/components/ui/button"

export type DashboardTab = "overview" | "recent" | "library" | "completion"

const tabConfig: Array<{ id: DashboardTab; label: string; icon: typeof BarChart3 }> = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "recent", label: "Recent", icon: Play },
  { id: "library", label: "Library", icon: Library },
  { id: "completion", label: "Completion", icon: Crosshair },
]

interface DashboardTabsProps {
  value: DashboardTab
  onChange: (value: DashboardTab) => void
}

export function DashboardTabs({ value, onChange }: DashboardTabsProps) {
  return (
    <div className="bg-card/80 flex flex-wrap gap-2 rounded-[1.2rem] border border-white/10 p-2">
      {tabConfig.map((tab) => {
        const Icon = tab.icon
        const active = value === tab.id

        return (
          <Button
            key={tab.id}
            variant={active ? "default" : "ghost"}
            size="sm"
            onClick={() => onChange(tab.id)}
            className={
              active
                ? "bg-accent text-accent-foreground hover:bg-accent/90"
                : "text-muted-foreground hover:text-foreground hover:bg-white/8"
            }
          >
            <Icon className="h-4 w-4" />
            {tab.label}
          </Button>
        )
      })}
    </div>
  )
}
