import React from "react"

interface SectionTitleProps {
  children: React.ReactNode
  className?: string
}

export function SectionTitle({ children, className = "text-xl font-semibold mb-6" }: SectionTitleProps) {
  return <h2 className={className}>{children}</h2>
}
