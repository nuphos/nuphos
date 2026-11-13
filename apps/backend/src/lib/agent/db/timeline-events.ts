import type { TurnFailureCause } from '@/lib/claude-code-preview/openab-acp-errors'
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
      /** A channel's agents used up their turns for this stretch; actorId is 'system'. */
      kind: 'agents_paused'
      turns: number
    }
  | {
      /** A channel post woke an agent that could not reply; actorId is 'system'. */
      kind: 'agent_reply_failed'
      agentName: string
      /** The agent's conversation, for a client's Retry and Switch agent; absent on older events. */
      agentId?: string
      /** Absent on older events. */
      cause?: TurnFailureCause
      /** Why, in a few words, when it is known and fit to show. */
      reason?: string
      /** When an agent out of usage gets it back, when its usage reading says. */
      resetsAt?: string
    }
  | {
      /** One of the session's messages was edited and ran again in a fork: the session it ran in. */
      kind: 'message_edited'
      forkSessionId: string
    }
  | {
      kind: 'conversation_forked'
      forkSessionId: string
    }
  | {
      kind: 'runtime_fallback_stopped'
      /** Each agent in the fallback list that was passed over, and why. */
      skipped: { label: string; reason: string }[]
    }
)
