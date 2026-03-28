import React from "react"

interface EmptyStateProps {
  message: string
  icon?: React.ReactNode
  className?: string
}

export function EmptyState({
  message,
  icon,
  className = "text-sm text-muted-foreground text-center py-8",
}: EmptyStateProps) {
  return (
    <div className={className}>
      {icon && <div className="mb-2 flex justify-center">{icon}</div>}
      <p>{message}</p>
    </div>
  )
}
