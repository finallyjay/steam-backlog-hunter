import React from "react"

interface ErrorMessageProps {
  message?: string
}

export function ErrorMessage({ message = "No se pudo obtener el usuario. Por favor, inicia sesión." }: ErrorMessageProps) {
  return <p className="text-center text-destructive py-8">{message}</p>
}
