"use client"

import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"

interface GamesFilterBarProps {
  order: string
  setOrder: (value: string) => void
  showCompleted: boolean
  setShowCompleted: (value: boolean) => void
}

export function GamesFilterBar({ order, setOrder, showCompleted, setShowCompleted }: GamesFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-6 mb-6 justify-between">
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">Ordenar por:</label>
        <Select value={order} onValueChange={setOrder}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Ordenar por..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="completed">% Completado</SelectItem>
            <SelectItem value="alphabetical">Alfabético</SelectItem>
            <SelectItem value="achievementsAsc">Menos logros</SelectItem>
            <SelectItem value="achievementsDesc">Más logros</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={showCompleted} onCheckedChange={setShowCompleted} id="showCompletedSwitch" />
        <label htmlFor="showCompletedSwitch" className="text-sm font-medium cursor-pointer">
          Incluir completados
        </label>
      </div>
    </div>
  )
}
