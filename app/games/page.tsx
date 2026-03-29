"use client"

import { useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { useCurrentUser } from "@/hooks/use-current-user"
import { LibraryOverview } from "@/components/dashboard/library-overview"
import { PageContainer } from "@/components/ui/page-container"
import { LoadingMessage } from "@/components/ui/loading-message"

export default function GamesPage() {
  const { user, loading } = useCurrentUser()
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  useEffect(() => {
    if (!loading && !user) {
      router.push("/")
    }
  }, [loading, router, user])

  if (loading) {
    return <LoadingMessage />
  }
  if (!user) {
    return null
  }

  return (
    <PageContainer>
      <h1 className="sr-only">Games Library</h1>
      <LibraryOverview initialFilter={searchParams.get("filter")} initialOrder={searchParams.get("order")} />
    </PageContainer>
  )
}
