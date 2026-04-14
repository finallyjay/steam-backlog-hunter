import { redirect } from "next/navigation"

import { requireAdmin } from "@/app/lib/require-admin"
import { AdminSubNav } from "@/components/admin/admin-sub-nav"
import { PageContainer } from "@/components/ui/page-container"

/**
 * Server-side admin gate for every page under `/admin/*`. Any user who
 * hits an admin URL without passing requireAdmin() is bounced to the
 * dashboard before rendering the page, so admin-only React trees never
 * reach a non-admin browser (the client-side nav gate is purely
 * cosmetic — this is the real enforcement).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin()
  if (!admin) {
    redirect("/dashboard")
  }

  return (
    <PageContainer>
      <div className="flex flex-col gap-6">
        <AdminSubNav />
        {children}
      </div>
    </PageContainer>
  )
}
