import React from "react"

interface PageHeaderProps {
  title: string
  icon?: React.ReactNode
  children?: React.ReactNode
}

export function PageHeader({ title, icon, children }: PageHeaderProps) {
  return (
    <header className="sticky top-0 z-40 mb-8 border-b border-white/10 bg-slate-950/70 backdrop-blur-xl">
      <div className="container mx-auto flex items-center justify-between px-4 py-4 md:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          {icon}
          <div>
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.32em] text-accent/80">Steam control room</p>
            <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
          </div>
        </div>
        {children}
      </div>
    </header>
  )
}
