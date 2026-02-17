"use client"

import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"

interface GamesFilterBarProps {
  order: "completed" | "alphabetical" | "achievementsAsc" | "achievementsDesc"
  setOrder: (value: "completed" | "alphabetical" | "achievementsAsc" | "achievementsDesc") => void
  showCompleted: boolean
  setShowCompleted: (value: boolean) => void
}

export function GamesFilterBar({ order, setOrder, showCompleted, setShowCompleted }: GamesFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-6 mb-6 justify-between">
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">Sort by:</label>
        <Select
          value={order}
          onValueChange={(value) => setOrder(value as "completed" | "alphabetical" | "achievementsAsc" | "achievementsDesc")}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Sort by..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="completed">% Completed</SelectItem>
            <SelectItem value="alphabetical">Alphabetical</SelectItem>
            <SelectItem value="achievementsAsc">Fewest achievements</SelectItem>
            <SelectItem value="achievementsDesc">Most achievements</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={showCompleted} onCheckedChange={setShowCompleted} id="showCompletedSwitch" />
        <label htmlFor="showCompletedSwitch" className="text-sm font-medium cursor-pointer">
          Include completed
        </label>
      </div>
    </div>
  )
}
