import React from "react"

interface CardGridItem {
  title: string
  value?: string | number
  description?: string
  icon?: React.ReactNode
  onClick?: () => void
  clickable?: boolean
  className?: string
}

interface CardGridProps {
  items: CardGridItem[]
  columns?: string
}

export function CardGrid({ items, columns = "grid-cols-2 lg:grid-cols-4" }: CardGridProps) {
  return (
    <div className={`grid ${columns} gap-4`}>
      {items.map((item, idx) => (
        <div
          key={item.title + idx}
          className={`border-2 rounded-lg bg-card hover:border-accent/50 transition-colors ${item.clickable ? "cursor-pointer" : ""} ${item.className || ""}`}
          onClick={item.onClick}
        >
          <div className="p-4">
            <div className="flex items-center gap-2 mb-2">
              {item.icon}
              <span className="font-medium text-muted-foreground text-sm">{item.title}</span>
            </div>
            {item.value && <div className="text-2xl font-bold">{item.value}</div>}
            {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
          </div>
        </div>
      ))}
    </div>
  )
}
