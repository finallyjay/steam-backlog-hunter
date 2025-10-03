import { getCurrentUser } from "@/app/lib/server-auth"

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return new Response(JSON.stringify({ user: null }), { status: 401 })
  }
  return new Response(JSON.stringify({ user }), { status: 200 })
}