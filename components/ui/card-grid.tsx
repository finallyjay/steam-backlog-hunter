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
          className={`group bg-card/90 overflow-hidden rounded-[1.35rem] border border-white/10 transition-all duration-300 ${item.clickable ? "hover:border-accent/60 cursor-pointer hover:-translate-y-1" : ""} ${item.className || ""}`}
          onClick={item.onClick}
        >
          <div className="p-5">
            <div className="text-accent/85 mb-3 flex items-center gap-2">
              {item.icon}
              <span className="text-muted-foreground text-xs font-semibold tracking-[0.2em] uppercase">
                {item.title}
              </span>
            </div>
            {item.value && <div className="text-3xl font-semibold tracking-tight">{item.value}</div>}
            {item.description && <p className="text-muted-foreground mt-1 text-sm">{item.description}</p>}
          </div>
        </div>
      ))}
    </div>
  )
}
