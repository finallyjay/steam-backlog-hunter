"use client"
import React, { createContext, useContext, useState } from "react"

const PageTitleContext = createContext({
  title: "",
  setTitle: (t: string) => {}
})

export function PageTitleProvider({ children }: { children: React.ReactNode }) {
  const [title, setTitle] = useState("")
  return (
    <PageTitleContext.Provider value={{ title, setTitle }}>
      {children}
    </PageTitleContext.Provider>
  )
}

export function usePageTitle() {
  return useContext(PageTitleContext)
}
