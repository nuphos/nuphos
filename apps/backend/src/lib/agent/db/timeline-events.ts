import type { TurnFailureCause } from '@/lib/claude-code-preview/openab-acp-errors'

/** Why an agent could not reply in a chat; `cli` when its CLI could not start. */
export type ReplyFailedCause = TurnFailureCause | 'cli'
import type { OpenAbProvider } from '@/lib/claude-code-preview/runtime-provider'

/** A channel with no reply-failed line yet from `agentId` for the post at `atMessage` (#3332). */
export const noReplyFailedYet = (agentId: string, atMessage: number | undefined) =>
  atMessage === undefined
    ? {}
    : {
        timelineEvents: {
          $not: { $elemMatch: { kind: 'agent_reply_failed', agentId, atMessage } },
        },
      }

/** What set, changed or took away a conversation's face. */
export type BotChangeSource =
  | { via: 'make_bot' | 'avatar_route' | 'new_bot' | 'update_self' | 'bot_import' }
  /** `sessionId` is the conversation whose agent called the tool. */
  | { via: 'create_bot'; sessionId: string }

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
      /** The turn that failed before the move runs again on `toLabel`. */
      retrying?: true
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
      cause?: ReplyFailedCause
      /** Why, in a few words, when it is known and fit to show. */
      reason?: string
      /** When an agent out of usage gets it back, when its usage reading says. */
      resetsAt?: string
      /** Where the account's holder verifies it, when its provider holds it until they do. */
      verifyUrl?: string
      /** The channel's message count when it failed: one line per post, however often it retries. */
      atMessage?: number
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
  | ({
      /** Its face was set, changed or taken away, and with a face it is a Bot.
       *  A record of who did that and how; clients are not sent it. */
      kind: 'bot_changed'
      /** The face it has now; absent when it was taken away. */
      avatar?: string
    } & BotChangeSource)
  | {
      kind: 'runtime_fallback_stopped'
      /** Each agent in the fallback list that was passed over, and why. */
      skipped: { label: string; reason: string }[]
    }
)
