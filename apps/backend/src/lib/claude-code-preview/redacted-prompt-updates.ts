import { logEvent } from '@/lib/observability'

import { lastTextChunkTracker } from './codex-turn-settle'
import { isAdapterWarning } from './openab-acp-timers'
import { previewTextMetadata } from './preview-text-metadata'
import { redactStreamedUpdates } from './streamed-token-redaction'

import type { PreviewAgentUpdate, PreviewTextMetadata } from './preview-agent-update'

type PromptTarget = { conversationId: string; provider: string; runtimeId?: string }

/** Keep the prompt's text metadata attached after streaming token redaction. */
export function redactedPromptUpdates(
  onText: (text: string, metadata?: PreviewTextMetadata) => void,
  onAgent?: (update: PreviewAgentUpdate) => void,
  target?: PromptTarget,
) {
  // How long the model takes to start answering, per agent (#4859).
  const sentAt = Date.now()
  let answered = false
  const firstOutput = () => {
    if (answered || !target) return
    answered = true
    logEvent('info', 'agent.chat.first_output', {
      session_id: target.conversationId,
      provider: target.provider,
      runtime_id: target.runtimeId,
      first_output_ms: Date.now() - sentAt,
    })
  }
  const text = lastTextChunkTracker(onText)
  const live = redactStreamedUpdates((update) => {
    if (update.kind === 'text') text.onTextDelta(update.text, previewTextMetadata(update))
    else if (update.kind === 'agent') onAgent?.(update.update)
  })

  return {
    last: text.last,
    flush: live.flush,
    onTextDelta: (delta: string, metadata?: PreviewTextMetadata) => {
      if (!isAdapterWarning(delta, metadata?.messageId)) firstOutput()
      live.deliver({ kind: 'text', text: delta, ...metadata })
    },
    onAgentUpdate: (update: PreviewAgentUpdate) => {
      if (update.kind === 'thought' || update.kind === 'tool') firstOutput()
      live.deliver({ kind: 'agent', update })
    },
  }
}
