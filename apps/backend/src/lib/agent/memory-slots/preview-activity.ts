// Internal, cross-replica activity frames for Claude Code memory MCP tools.
// They ride the existing run bridge but are consumed by the hosting turn and
// never reach the Desktop SSE stream.
import type { TurnMemoryAccumulator } from './turn-accumulator'
import type { MemoryFetchedEvent, MemorySavedEvent } from './types'

const PREVIEW_MEMORY_ACTIVITY = 'atlas-preview-memory-activity'

export type PreviewMemoryActivityFrame =
  | { type: typeof PREVIEW_MEMORY_ACTIVITY; activity: 'fetched'; event: MemoryFetchedEvent }
  | { type: typeof PREVIEW_MEMORY_ACTIVITY; activity: 'saved'; event: MemorySavedEvent }

export function previewMemoryActivityFrame(
  activity: 'fetched' | 'saved',
  event: MemoryFetchedEvent | MemorySavedEvent,
): PreviewMemoryActivityFrame {
  return { type: PREVIEW_MEMORY_ACTIVITY, activity, event } as PreviewMemoryActivityFrame
}

/** Returns true for every internal activity frame, even without an active
 * accumulator, so transport-only frames can never leak into the UI. */
export function consumePreviewMemoryActivity(
  accumulator: TurnMemoryAccumulator | null,
  frame: Record<string, unknown>,
): boolean {
  if (frame.type !== PREVIEW_MEMORY_ACTIVITY) return false
  if (!accumulator || !frame.event || typeof frame.event !== 'object') return true

  if (frame.activity === 'fetched') {
    accumulator.observer.fetched(frame.event as MemoryFetchedEvent)
  } else if (frame.activity === 'saved') {
    accumulator.noteSaved(frame.event as MemorySavedEvent)
  }

  return true
}
