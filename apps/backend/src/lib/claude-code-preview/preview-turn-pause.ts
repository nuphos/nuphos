// The run-side half of a blocking decision: while a Claude Code turn is
// parked inside an MCP tool, the desktop expects the SSE stream to END (that
// is what triggers its client-tool phase and its approve/deny resume POST)
// and then re-attaches on a NEW streamId. This watcher tells the seam when to
// close the current run and which stream to adopt for the continuation.
import { listPendingPreviewWaits, takePreviewDecision } from './decision-waiter'

import type { PreviewDecision, PreviewWait } from './decision-waiter'

export type PreviewPauseWatcher = {
  userId: string
  sessionId: string
  signal: AbortSignal
  onPause: (wait: PreviewWait) => void | Promise<void>
  onResume: (wait: PreviewWait, decision: PreviewDecision) => void | Promise<void>
  pollMs?: number
}

const DEFAULT_POLL_MS = 500

/**
 * Polls the wait store for the turn's lifetime. Each new wait fires `onPause`
 * once; its decision fires `onResume` once. Resolves when the signal aborts.
 */
export async function watchPreviewTurnPauses(watcher: PreviewPauseWatcher): Promise<void> {
  const pollMs = watcher.pollMs ?? DEFAULT_POLL_MS
  const seen = new Map<string, PreviewWait>()
  const resolved = new Set<string>()

  while (!watcher.signal.aborted) {
    try {
      const pending = await listPendingPreviewWaits(watcher.userId, watcher.sessionId)

      for (const wait of pending) {
        // The permission bridge owns these: the turn stays live while it waits.
        if (wait.kind === 'agent-permission' || seen.has(wait.waitId)) continue
        seen.set(wait.waitId, wait)
        await watcher.onPause(wait)
      }
      for (const [waitId, wait] of seen) {
        if (resolved.has(waitId)) continue
        const decision = await takePreviewDecision(watcher.userId, watcher.sessionId, waitId)

        if (!decision) continue
        resolved.add(waitId)
        await watcher.onResume(wait, decision)
      }
    } catch {
      // Store hiccups are transient; the next tick retries.
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}
