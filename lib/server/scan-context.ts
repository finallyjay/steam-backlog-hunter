import "server-only"

import { AsyncLocalStorage } from "node:async_hooks"

type ScanContext = {
  /** ISO timestamp identifying the scheduled scan run (its `startedAt`). */
  startedAt: string
}

// Lets the scheduled scan tag the achievement_changes rows it causes without
// threading a parameter through the shared sync path (which the in-app sync
// also uses). Anything recorded outside `runWithScanContext` is attributed
// to no scan, so a manual sync running concurrently never leaks into the
// scan's summary.
const storage = new AsyncLocalStorage<ScanContext>()

/** Runs `fn` with the given scan attached to every async continuation inside it. */
export function runWithScanContext<T>(startedAt: string, fn: () => Promise<T>): Promise<T> {
  return storage.run({ startedAt }, fn)
}

/** The scan the current async chain belongs to, or null outside a scan. */
export function getScanContext(): ScanContext | null {
  return storage.getStore() ?? null
}
