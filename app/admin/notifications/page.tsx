"use client"

import { useCallback, useEffect, useState } from "react"
import { Bell, Check, MessageSquare, Send } from "lucide-react"

import { Button } from "@/components/ui/button"
import { InputFrame } from "@/components/ui/input-frame"
import { LoadingMessage } from "@/components/ui/loading-message"
import { SurfaceCard } from "@/components/ui/surface-card"
import { Switch } from "@/components/ui/switch"

type SettingsView = {
  discord: { enabled: boolean; webhookConfigured: boolean; webhookHint: string | null }
  telegram: {
    enabled: boolean
    botTokenConfigured: boolean
    botTokenHint: string | null
    chatId: string | null
    threadId: string | null
  }
  updatedAt: string | null
}

type Draft = {
  discordEnabled: boolean
  webhookUrl: string
  telegramEnabled: boolean
  botToken: string
  chatId: string
  threadId: string
}

type Channel = "discord" | "telegram"

const INPUT_CLASS =
  "text-foreground placeholder:text-muted-foreground h-full w-full bg-transparent text-sm focus:outline-none"

function draftFrom(view: SettingsView): Draft {
  return {
    discordEnabled: view.discord.enabled,
    webhookUrl: "",
    telegramEnabled: view.telegram.enabled,
    botToken: "",
    chatId: view.telegram.chatId ?? "",
    threadId: view.telegram.threadId ?? "",
  }
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-muted-foreground block text-xs font-medium">
        {label}
      </label>
      {children}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  )
}

/**
 * /admin/notifications — where the scheduled scan's outbound summary goes.
 *
 * Secrets are write-only: the form never receives the stored webhook URL or
 * bot token, only a short hint, and leaving the field blank keeps the stored
 * value. "Send test" uses the *saved* settings, so save first.
 */
export default function NotificationsAdminPage() {
  const [view, setView] = useState<SettingsView | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<Channel | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/notifications")
    if (!res.ok) throw new Error("Failed to load")
    const data = (await res.json()) as { settings: SettingsView }
    setView(data.settings)
    setDraft(draftFrom(data.settings))
  }, [])

  useEffect(() => {
    async function run() {
      try {
        await load()
      } catch {
        setError("Failed to load notification settings")
      } finally {
        setLoading(false)
      }
    }
    void run()
  }, [load])

  const update = (patch: Partial<Draft>) => setDraft((prev) => (prev ? { ...prev, ...patch } : prev))

  const handleSave = async () => {
    if (!draft) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch("/api/admin/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discord: { enabled: draft.discordEnabled, webhookUrl: draft.webhookUrl },
          telegram: {
            enabled: draft.telegramEnabled,
            botToken: draft.botToken,
            chatId: draft.chatId,
            threadId: draft.threadId,
          },
        }),
      })
      const data = (await res.json().catch(() => null)) as { settings?: SettingsView; error?: string } | null
      if (!res.ok || !data?.settings) {
        throw new Error(data?.error || "Failed to save notification settings")
      }
      setView(data.settings)
      setDraft(draftFrom(data.settings))
      setNotice("Settings saved")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save notification settings")
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async (channel: Channel) => {
    setTesting(channel)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch("/api/admin/notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      })
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) throw new Error(data?.error || `Failed to send ${channel} test`)
      setNotice(`Test message sent to ${channel}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to send ${channel} test`)
    } finally {
      setTesting(null)
    }
  }

  if (loading) return <LoadingMessage />
  if (!view || !draft) {
    return <p className="text-destructive text-sm">{error ?? "Failed to load notification settings"}</p>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Bell className="text-accent h-5 w-5" />
          Notifications
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          When the scheduled achievement scan detects new or retired achievements, it posts a summary to each enabled
          channel. Secrets are stored encrypted and never shown again; leave a field blank to keep the saved value.
        </p>
      </div>

      <SurfaceCard className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <MessageSquare className="h-4 w-4" />
            Discord
          </h2>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground" aria-hidden="true">
              Enabled
            </span>
            <Switch
              checked={draft.discordEnabled}
              onCheckedChange={(checked) => update({ discordEnabled: checked })}
              aria-label="Enable Discord notifications"
            />
          </div>
        </div>
        <Field
          id="discord-webhook"
          label="Webhook URL"
          hint={
            view.discord.webhookConfigured
              ? `Saved (${view.discord.webhookHint}). Paste a new URL to replace it.`
              : "Server settings → Integrations → Webhooks → New webhook → Copy URL."
          }
        >
          <InputFrame>
            <input
              id="discord-webhook"
              type="password"
              autoComplete="off"
              value={draft.webhookUrl}
              onChange={(e) => update({ webhookUrl: e.target.value })}
              placeholder="https://discord.com/api/webhooks/…"
              className={INPUT_CLASS}
            />
          </InputFrame>
        </Field>
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => void handleTest("discord")}
            disabled={testing !== null || !view.discord.webhookConfigured}
          >
            <Send className="h-3.5 w-3.5" />
            {testing === "discord" ? "Sending…" : "Send test"}
          </Button>
        </div>
      </SurfaceCard>

      <SurfaceCard className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <Send className="h-4 w-4" />
            Telegram
          </h2>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground" aria-hidden="true">
              Enabled
            </span>
            <Switch
              checked={draft.telegramEnabled}
              onCheckedChange={(checked) => update({ telegramEnabled: checked })}
              aria-label="Enable Telegram notifications"
            />
          </div>
        </div>
        <Field
          id="telegram-token"
          label="Bot token"
          hint={
            view.telegram.botTokenConfigured
              ? `Saved (${view.telegram.botTokenHint}). Paste a new token to replace it.`
              : "Create a bot with @BotFather and paste the token it gives you."
          }
        >
          <InputFrame>
            <input
              id="telegram-token"
              type="password"
              autoComplete="off"
              value={draft.botToken}
              onChange={(e) => update({ botToken: e.target.value })}
              placeholder="123456789:AAAA…"
              className={INPUT_CLASS}
            />
          </InputFrame>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="telegram-chat"
            label="Chat id"
            hint="Your user id, or the group/channel id (negative). The bot must be a member."
          >
            <InputFrame>
              <input
                id="telegram-chat"
                type="text"
                inputMode="numeric"
                value={draft.chatId}
                onChange={(e) => update({ chatId: e.target.value })}
                placeholder="123456789 or -1001234567890"
                className={INPUT_CLASS}
              />
            </InputFrame>
          </Field>
          <Field
            id="telegram-thread"
            label="Thread id (optional)"
            hint="For groups with topics: the topic id to post into. Leave blank for the main chat."
          >
            <InputFrame>
              <input
                id="telegram-thread"
                type="text"
                inputMode="numeric"
                value={draft.threadId}
                onChange={(e) => update({ threadId: e.target.value })}
                placeholder="42"
                className={INPUT_CLASS}
              />
            </InputFrame>
          </Field>
        </div>
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => void handleTest("telegram")}
            disabled={testing !== null || !view.telegram.botTokenConfigured || !view.telegram.chatId}
          >
            <Send className="h-3.5 w-3.5" />
            {testing === "telegram" ? "Sending…" : "Send test"}
          </Button>
        </div>
      </SurfaceCard>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void handleSave()} disabled={saving} className="gap-1.5">
          <Check className="h-4 w-4" />
          {saving ? "Saving…" : "Save settings"}
        </Button>
        {view.updatedAt ? (
          <span className="text-muted-foreground text-xs">Last saved {new Date(view.updatedAt).toLocaleString()}</span>
        ) : null}
        {notice ? <output className="text-success text-sm">{notice}</output> : null}
        {error ? (
          <span className="text-destructive text-sm" role="alert">
            {error}
          </span>
        ) : null}
      </div>
    </div>
  )
}
