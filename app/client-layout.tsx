"use client"

import { DashboardHeader } from '@/components/dashboard/dashboard-header'
import { useCurrentUser } from '@/hooks/use-current-user'
import { usePathname } from 'next/navigation'
import { Analytics } from '@vercel/analytics/next'
import { Skeleton } from '@/components/ui/skeleton'
import { usePageTitle } from '@/components/ui/page-title-context'

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { user, loading } = useCurrentUser()
  const { title } = usePageTitle()

  return (
    <>
      {/* Mostrar cabecera en todas las páginas menos la raíz (inicio de sesión) */}
      {pathname !== '/' && (
        loading ? (
          <div className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-40">
            <div className="container mx-auto px-4 py-4">
              <div className="flex items-center gap-2">
                <Skeleton className="h-8 w-8" />
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-6 w-12 ml-2" />
              </div>
            </div>
          </div>
        ) : (
          user && <DashboardHeader user={user} />
        )
      )}
      {title && (
        <div className="w-full pt-7 pb-4 px-4 text-center text-3xl font-bold">
          {title}
        </div>
      )}
      <div className="min-h-screen">
        {children}
      </div>
      <Analytics />
    </>
  )
}
