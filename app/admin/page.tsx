"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useCurrentUser } from "@/hooks/use-current-user"
import { PageContainer } from "@/components/ui/page-container"
import { LoadingMessage } from "@/components/ui/loading-message"
import { Button } from "@/components/ui/button"
import { Trash2, UserPlus } from "lucide-react"

interface AllowedUser {
  steam_id: string
  added_by: string | null
  added_at: string
}

export default function AdminPage() {
  const { user, loading } = useCurrentUser()
  const router = useRouter()
  const [users, setUsers] = useState<AllowedUser[]>([])
  const [loadingUsers, setLoadingUsers] = useState(true)
  const [newSteamId, setNewSteamId] = useState("")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!loading && !user) {
      router.push("/")
    }
  }, [loading, user, router])

  useEffect(() => {
    async function loadUsers() {
      try {
        const res = await fetch("/api/admin/users")
        if (res.status === 403) {
          router.push("/dashboard")
          return
        }
        if (!res.ok) throw new Error("Failed to load users")
        const data = await res.json()
        setUsers(data.users)
      } catch {
        setError("Failed to load users")
      } finally {
        setLoadingUsers(false)
      }
    }
    if (user) void loadUsers()
  }, [user, router])

  const handleAdd = async () => {
    if (!/^\d{17}$/.test(newSteamId.trim())) {
      setError("Steam ID must be 17 digits")
      return
    }
    setError(null)
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steamId: newSteamId.trim() }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to add user")
      }
      setNewSteamId("")
      // Reload users
      const res2 = await fetch("/api/admin/users")
      if (!res2.ok) {
        throw new Error("User added, but failed to reload users list")
      }
      const data = await res2.json()
      setUsers(data.users)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add user")
    }
  }

  const handleRemove = async (steamId: string) => {
    try {
      const res = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steamId }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to remove user")
      }
      setUsers((prev) => prev.filter((u) => u.steam_id !== steamId))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove user")
    }
  }

  if (loading) {
    return <LoadingMessage />
  }
  if (!user) {
    return null
  }

  return (
    <PageContainer>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">User Management</h1>

      {error && <div className="bg-destructive/10 text-destructive mb-4 rounded-md px-4 py-3 text-sm">{error}</div>}

      <div className="mb-6 flex gap-2">
        <input
          type="text"
          value={newSteamId}
          onChange={(e) => setNewSteamId(e.target.value)}
          placeholder="Steam64 ID (17 digits)"
          aria-label="Steam64 ID"
          className="border-surface-4 bg-surface-1 text-foreground placeholder:text-muted-foreground focus:border-accent rounded-md border px-3 py-2 text-sm focus:outline-none"
        />
        <Button size="sm" onClick={handleAdd} className="gap-1.5">
          <UserPlus className="h-3.5 w-3.5" />
          Add User
        </Button>
      </div>

      {loadingUsers ? (
        <p className="text-muted-foreground">Loading users...</p>
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <div
              key={u.steam_id}
              className="border-surface-4 bg-surface-1 flex items-center justify-between rounded-lg border px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium">{u.steam_id}</p>
                <p className="text-muted-foreground text-xs">
                  Added {u.added_by === "env_seed" ? "from env var" : u.added_by ? `by ${u.added_by}` : "manually"} ·{" "}
                  {new Date(u.added_at).toLocaleDateString()}
                </p>
              </div>
              {u.steam_id !== user.steamId && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemove(u.steam_id)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${u.steam_id}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </PageContainer>
  )
}
