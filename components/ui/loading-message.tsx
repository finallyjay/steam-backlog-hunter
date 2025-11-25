import React from "react"

interface LoadingMessageProps {
  message?: string
}

export function LoadingMessage({ message = "Loading user..." }: LoadingMessageProps) {
  return <p className="text-center text-muted-foreground py-8">{message}</p>
}
