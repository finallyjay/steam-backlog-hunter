import React from "react"

interface PageContainerProps {
  children: React.ReactNode
  className?: string
}

export function PageContainer({ children, className = "" }: PageContainerProps) {
  return (
    <div className={`min-h-screen ${className}`}>
      <main className="container mx-auto px-4 py-8 md:px-6 lg:px-8">
        {children}
      </main>
    </div>
  )
}
