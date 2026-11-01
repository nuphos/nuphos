import type { OpenAbProvider } from '@/lib/claude-code-preview/runtime-provider'

/** Why a fallback moved a conversation: its agent was low on usage, unreachable, or failed a turn. */
export type RuntimeFallbackReason = 'quota' | 'offline' | 'failure'

// Not in agent_messages: transcript sync replaces those and feeds them to the model.
export type ConversationTimelineEvent = { at: Date; actorId: string } & (
  | { kind: 'participant_invited' | 'participant_removed'; targetId: string }
  | {
      kind: 'runtime_moved'
      fromLabel?: string
      fromProvider?: OpenAbProvider
      toLabel: string
      toProvider?: OpenAbProvider
      /** Set when a fallback moved it rather than a person. */
      reason?: RuntimeFallbackReason
    }
  | {
      kind: 'runtime_fallback_stopped'
      /** Each agent in the fallback list that was passed over, and why. */
      skipped: { label: string; reason: string }[]
    }
)
