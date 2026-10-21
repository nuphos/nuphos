import { lastTextChunkTracker } from './codex-turn-settle'
import { previewTextMetadata } from './preview-text-metadata'
import { redactStreamedUpdates } from './streamed-token-redaction'

import type { PreviewAgentUpdate, PreviewTextMetadata } from './preview-agent-update'

/** Keep the prompt's text metadata attached after streaming token redaction. */
export function redactedPromptUpdates(
  onText: (text: string, metadata?: PreviewTextMetadata) => void,
  onAgent?: (update: PreviewAgentUpdate) => void,
) {
  const text = lastTextChunkTracker(onText)
  const live = redactStreamedUpdates((update) => {
    if (update.kind === 'text') text.onTextDelta(update.text, previewTextMetadata(update))
    else if (update.kind === 'agent') onAgent?.(update.update)
  })

  return {
    last: text.last,
    flush: live.flush,
    onTextDelta: (delta: string, metadata?: PreviewTextMetadata) => {
      live.deliver({ kind: 'text', text: delta, ...metadata })
    },
    onAgentUpdate: (update: PreviewAgentUpdate) => {
      live.deliver({ kind: 'agent', update })
    },
  }
}
