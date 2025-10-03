import React from "react"

interface PageHeaderProps {
  title: string
  icon?: React.ReactNode
  children?: React.ReactNode
}

export function PageHeader({ title, icon, children }: PageHeaderProps) {
  return (
    <header className="border-b bg-card/50 backdrop-blur-sm mb-8">
      <div className="container mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <h1 className="text-2xl font-bold text-balance">{title}</h1>
        </div>
        {children}
      </div>
    </header>
  )
}
