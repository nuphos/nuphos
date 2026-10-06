import type { OpenAbProvider } from '@/lib/claude-code-preview/runtime-provider'

// Not in agent_messages: transcript sync replaces those and feeds them to the model.
export type ConversationTimelineEvent = { at: Date; actorId: string } & (
  | { kind: 'participant_invited' | 'participant_removed'; targetId: string }
  | {
      kind: 'runtime_moved'
      fromLabel?: string
      fromProvider?: OpenAbProvider
      toLabel: string
      toProvider?: OpenAbProvider
    }
)
