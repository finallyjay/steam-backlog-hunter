import React from "react"

interface ErrorMessageProps {
  message?: string
}

export function ErrorMessage({ message = "Could not fetch user. Please sign in." }: ErrorMessageProps) {
  return <p className="text-destructive py-8 text-center">{message}</p>
}
