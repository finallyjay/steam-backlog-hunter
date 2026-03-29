import React from "react"

export function PageFooter() {
  return (
    <footer className="border-surface-4 bg-background/55 mt-16 border-t">
      <div className="container mx-auto px-4 py-8 md:px-6 lg:px-8">
        <div className="text-muted-foreground flex flex-col gap-2 text-center text-sm md:flex-row md:items-center md:justify-between">
          <p>Built as a personal control room for Steam backlog and achievement hunting.</p>
          <p>Not affiliated with Valve Corporation.</p>
        </div>
      </div>
    </footer>
  )
}
