"use client"
import React, { createContext, useContext, useState } from "react"

interface PageTitleContextValue {
  title: string
  setTitle: (title: string) => void
}

const PageTitleContext = createContext<PageTitleContextValue>({
  title: "",
  setTitle: () => {},
})

export function PageTitleProvider({ children }: { children: React.ReactNode }) {
  const [title, setTitle] = useState("")
  return <PageTitleContext.Provider value={{ title, setTitle }}>{children}</PageTitleContext.Provider>
}

export function usePageTitle() {
  return useContext(PageTitleContext)
}
