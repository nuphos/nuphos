import { consumePreviewMemoryActivity } from '@/lib/agent/memory-slots/preview-activity'

import { consumePreviewToolPresentation } from './chat-preview-tool-update'

import type { PreviewTurnMemory } from './chat-preview-memory'
import type { createPreviewRunState } from './chat-preview-run'
import type { createPreviewToolLog } from './chat-preview-tool-log'

export function installPreviewFrameConsumer(
  state: ReturnType<typeof createPreviewRunState>,
  tools: ReturnType<typeof createPreviewToolLog>,
  memory: PreviewTurnMemory | null,
): void {
  state.consumeFrames(
    (frame) =>
      consumePreviewToolPresentation(state.emit, tools, frame) ||
      consumePreviewMemoryActivity(memory?.turnMemory.accumulator ?? null, frame),
  )
}
