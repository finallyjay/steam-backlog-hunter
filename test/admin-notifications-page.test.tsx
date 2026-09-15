// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import NotificationsAdminPage from "@/app/admin/notifications/page"

const ORIGINAL_FETCH = globalThis.fetch

type View = {
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

const emptyView: View = {
  discord: { enabled: false, webhookConfigured: false, webhookHint: null },
  telegram: { enabled: false, botTokenConfigured: false, botTokenHint: null, chatId: null, threadId: null },
  updatedAt: null,
}

const configuredView: View = {
  discord: { enabled: true, webhookConfigured: true, webhookHint: "…abcd" },
  telegram: { enabled: true, botTokenConfigured: true, botTokenHint: "…GGGG", chatId: "-100123", threadId: "42" },
  updatedAt: "2026-09-15T00:00:00.000Z",
}

type Call = { url: string; init?: RequestInit }

function mockFetch(view: View, handlers?: Partial<Record<string, (init?: RequestInit) => Response>>) {
  const calls: Call[] = []
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    const key = `${init?.method ?? "GET"} ${url}`
    if (handlers?.[key]) return handlers[key]!(init)
    if (key === "GET /api/admin/notifications") {
      return { ok: true, status: 200, json: async () => ({ settings: view }) } as Response
    }
    return { ok: true, status: 200, json: async () => ({ settings: view }) } as Response
  }) as unknown as typeof fetch
  return calls
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
  globalThis.fetch = ORIGINAL_FETCH
})

describe("NotificationsAdminPage", () => {
  it("loads settings, shows hints for stored secrets and enables test buttons only when configured", async () => {
    mockFetch(configuredView)
    render(<NotificationsAdminPage />)

    expect(await screen.findByText(/Saved \(…abcd\)/)).toBeInTheDocument()
    expect(screen.getByText(/Saved \(…GGGG\)/)).toBeInTheDocument()
    expect(screen.getByLabelText("Chat id")).toHaveValue("-100123")
    expect(screen.getByLabelText("Thread id (optional)")).toHaveValue("42")
    // Secrets are never prefilled.
    expect(screen.getByLabelText("Webhook URL")).toHaveValue("")
    expect(screen.getByLabelText("Bot token")).toHaveValue("")

    const testButtons = screen.getAllByRole("button", { name: /send test/i })
    expect(testButtons).toHaveLength(2)
    expect(testButtons[0]).toBeEnabled()
    expect(testButtons[1]).toBeEnabled()
  })

  it("disables test buttons when nothing is configured", async () => {
    mockFetch(emptyView)
    render(<NotificationsAdminPage />)
    await screen.findByRole("button", { name: /save settings/i })
    for (const button of screen.getAllByRole("button", { name: /send test/i })) {
      expect(button).toBeDisabled()
    }
  })

  it("saves the draft with blanks for untouched secrets and shows the server error", async () => {
    const calls = mockFetch(emptyView, {
      "PUT /api/admin/notifications": () =>
        ({
          ok: false,
          status: 400,
          json: async () => ({ error: "Enter a Discord webhook URL before enabling Discord notifications" }),
        }) as Response,
    })
    render(<NotificationsAdminPage />)
    await screen.findByRole("button", { name: /save settings/i })

    fireEvent.click(screen.getByLabelText("Enable Discord notifications"))
    fireEvent.change(screen.getByLabelText("Chat id"), { target: { value: "123" } })
    fireEvent.click(screen.getByRole("button", { name: /save settings/i }))

    expect(await screen.findByRole("alert")).toHaveTextContent(/webhook URL/)
    const put = calls.find((c) => c.init?.method === "PUT")
    expect(JSON.parse(String(put?.init?.body))).toEqual({
      discord: { enabled: true, webhookUrl: "" },
      telegram: { enabled: false, botToken: "", chatId: "123", threadId: "" },
    })
  })

  it("confirms a successful save and sends a channel test", async () => {
    const calls = mockFetch(configuredView, {
      "POST /api/admin/notifications/test": () =>
        ({ ok: true, status: 200, json: async () => ({ ok: true }) }) as Response,
    })
    render(<NotificationsAdminPage />)
    await screen.findByRole("button", { name: /save settings/i })

    fireEvent.click(screen.getByRole("button", { name: /save settings/i }))
    expect(await screen.findByRole("status")).toHaveTextContent("Settings saved")

    fireEvent.click(screen.getAllByRole("button", { name: /send test/i })[1]!)
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Test message sent to telegram"))
    const test = calls.find((c) => c.url.endsWith("/test"))
    expect(JSON.parse(String(test?.init?.body))).toEqual({ channel: "telegram" })
  })
})
