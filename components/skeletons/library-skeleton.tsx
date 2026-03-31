import { Skeleton } from "@/components/ui/skeleton"
import { PageContainer } from "@/components/ui/page-container"

function GameCardSkeleton() {
  return (
    <div className="border-surface-4 bg-surface-1 flex items-stretch gap-4 rounded-lg border px-4 py-4">
      <Skeleton className="h-[5.9rem] w-48 rounded-2xl" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-5 w-44" />
        <div className="flex gap-4">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="h-2 w-full rounded-full" />
      </div>
    </div>
  )
}

export function LibrarySkeleton() {
  return (
    <PageContainer>
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="w-36 space-y-1.5">
              <Skeleton className="h-3 w-14" />
              <Skeleton className="h-9 w-full rounded-lg" />
            </div>
            <div className="w-44 space-y-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-9 w-full rounded-lg" />
            </div>
            <div className="w-48 space-y-1.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9 w-full rounded-lg" />
            </div>
          </div>
          <div className="w-48 space-y-1.5">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-9 w-full rounded-lg" />
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          <Skeleton className="h-9 flex-1 rounded-lg" />
          <Skeleton className="h-4 w-20" />
        </div>

        <hr className="border-surface-4" />

        <div className="space-y-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <GameCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </PageContainer>
  )
}
