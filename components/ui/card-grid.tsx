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
          className={`group overflow-hidden rounded-[1.35rem] border border-white/10 bg-card/90 transition-all duration-300 ${item.clickable ? "cursor-pointer hover:-translate-y-1 hover:border-accent/60" : ""} ${item.className || ""}`}
          onClick={item.onClick}
        >
          <div className="p-5">
            <div className="mb-3 flex items-center gap-2 text-accent/85">
              {item.icon}
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">{item.title}</span>
            </div>
            {item.value && <div className="text-3xl font-semibold tracking-tight">{item.value}</div>}
            {item.description && <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>}
          </div>
        </div>
      ))}
    </div>
  )
}
