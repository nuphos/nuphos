import { wakeupTailLeavesHole } from '../../../lib/runtimeWakeup.ts'

/** Transcript ownership is transport bookkeeping, independent of runtime activity.
 * During a fresh retry the runtime is idle and no backend run exists yet. */
export function shouldDeferTranscriptCatchUp(
  tab: { streaming: boolean; streamId: string | null },
  activeRun: { streamId: string } | null | undefined,
): boolean {
  return (
    tab.streaming && Boolean(tab.streamId) && (!activeRun || activeRun.streamId === tab.streamId)
  )
}

type CatchUpTab = {
  streaming: boolean
  historyBaseIndex?: number
  messages: readonly unknown[]
}

/** A history response must not resurrect a failed attempt after reset-partial,
 * or overwrite frames/messages that arrived while the request was in flight. */
export async function fetchWakeupTranscriptTail<
  T extends CatchUpTab,
  D extends { messagesFirstIndex?: number },
>(
  readTab: () => T | undefined,
  load: (tail: number) => Promise<D>,
  tail: number,
  fullTail: number,
): Promise<{ detail: D; latest: T } | null> {
  const source = readTab()

  if (!source || source.streaming) return null
  const stillCurrent = () => {
    const latest = readTab()

    return latest && !latest.streaming && latest.messages === source.messages ? latest : null
  }
  let detail = await load(tail)
  let latest = stillCurrent()

  if (!latest) return null
  if (
    wakeupTailLeavesHole(
      detail.messagesFirstIndex ?? 0,
      latest.historyBaseIndex,
      latest.messages.length,
    )
  ) {
    detail = await load(fullTail)
    latest = stillCurrent()
    if (!latest) return null
  }

  return { detail, latest }
}
