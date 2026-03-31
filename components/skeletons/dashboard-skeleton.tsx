import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { PageContainer } from "@/components/ui/page-container"

function UserProfileSkeleton() {
  return (
    <Card className="border-surface-4 overflow-hidden">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <Skeleton className="h-14 w-14 rounded-2xl" />
            <div className="space-y-2">
              <Skeleton className="h-7 w-40" />
              <div className="flex gap-2">
                <Skeleton className="h-10 w-10 rounded-full" />
                <Skeleton className="h-10 w-10 rounded-full" />
              </div>
            </div>
          </div>
          <div className="space-y-2 text-right">
            <Skeleton className="ml-auto h-3 w-24" />
            <Skeleton className="ml-auto h-8 w-16" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-5">
          <Skeleton className="h-9 w-32" />
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="border-surface-4 bg-surface-1 rounded-lg border px-4 py-4">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="mt-3 h-7 w-12" />
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function InsightCardSkeleton() {
  return (
    <Card className="border-surface-4">
      <CardHeader className="space-y-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-5 rounded" />
          <Skeleton className="h-6 w-28" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-5">
          <div className="border-surface-3 bg-surface-1 rounded-lg border p-4">
            <Skeleton className="mb-2 h-4 w-32" />
            <Skeleton className="mb-3 h-3 w-48" />
            <Skeleton className="mx-auto h-44 w-44 rounded-full" />
          </div>
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-surface-1 flex items-center justify-between rounded-lg px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-2.5 w-2.5 rounded-full" />
                  <Skeleton className="h-4 w-20" />
                </div>
                <Skeleton className="h-4 w-8" />
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function RecentGamesSkeleton() {
  return (
    <Card className="border-surface-4">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-5 rounded" />
          <Skeleton className="h-6 w-48" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="border-surface-4 flex items-stretch gap-4 rounded-lg border px-4 py-4">
              <Skeleton className="h-[5.9rem] w-48 rounded-2xl" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-2 w-full rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export function DashboardSkeleton() {
  return (
    <PageContainer>
      <div className="grid gap-8">
        <UserProfileSkeleton />
        <div className="grid gap-6 xl:grid-cols-2">
          <InsightCardSkeleton />
          <InsightCardSkeleton />
        </div>
        <RecentGamesSkeleton />
      </div>
    </PageContainer>
  )
}
