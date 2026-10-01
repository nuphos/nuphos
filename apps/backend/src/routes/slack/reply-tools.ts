import { addSlackReaction, removeSlackReaction, searchSlackAssistantContext } from '@/lib/slack/api'
import { normalizeEmojiName } from '@/routes/slack/shared'

import type {
  SlackCreatedPlan,
  SlackReactToolInput,
  SlackReactToolResult,
  SlackReplyToolContext,
  SlackSearchToolInput,
  SlackSearchToolResult,
} from '@/lib/agent/tools-skilled/types'

// slack_search (assistant.search.context) depends on the search:read.* bot
// scopes, which are still pending Slack review. Until they are approved and
// re-added to SLACK_BOT_SCOPES, keep the tool unregistered so the agent never
// calls the unapproved API. Flip to true (and restore the scopes in
// lib/slack/oauth.ts) to re-enable.
const SLACK_SEARCH_ENABLED = false

export function createSlackReplyToolContext(args: {
  token: string
  channel: string
  // The originating user message, so slack_react can react to it. Absent for
  // synthetic turns (e.g. plan approval), which then register no slack_react.
  messageTs?: string
  // Scopes slack_search results to the channel the user is viewing/writing in.
  contextChannelId?: string
  // Lifted from the inbound Slack event; required so slack_search's bot-token
  // assistant.search.context calls carry an action_token.
  actionToken?: string
  // Sender of the triggering message; surfaces in the system prompt so the
  // model can @-mention them (transcripts carry display names, not ids).
  sender?: { slackUserId: string; displayName?: string | null }
}): SlackReplyToolContext & {
  getCreatedPlans: () => SlackCreatedPlan[]
} {
  const createdPlans: SlackCreatedPlan[] = []

  const messageTs = args.messageTs
  const react = messageTs
    ? async (input: SlackReactToolInput): Promise<SlackReactToolResult> => {
        const name = normalizeEmojiName(input.name)

        if (!name) {
          return { ok: false, action: input.action, name: input.name, error: 'Empty emoji name' }
        }
        try {
          if (input.action === 'add') {
            await addSlackReaction({
              token: args.token,
              channel: args.channel,
              ts: messageTs,
              name,
            })
          } else {
            await removeSlackReaction({
              token: args.token,
              channel: args.channel,
              ts: messageTs,
              name,
            })
          }

          return { ok: true, action: input.action, name }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)

          // Idempotent no-ops: the reaction already exists, or isn't there to remove.
          if (message.includes('already_reacted') || message.includes('no_reaction')) {
            return { ok: true, action: input.action, name }
          }

          return { ok: false, action: input.action, name, error: message }
        }
      }
    : undefined

  const search = async (input: SlackSearchToolInput): Promise<SlackSearchToolResult> => {
    const limit = input.limit ?? 10

    try {
      const response = await searchSlackAssistantContext({
        token: args.token,
        query: input.query,
        actionToken: args.actionToken,
        contextChannelId: args.contextChannelId,
        contentTypes: ['messages'],
        limit,
      })
      const messages = response.results?.messages ?? []

      return {
        ok: true,
        results: messages.slice(0, limit).map((message) => ({
          channel: typeof message.channel_id === 'string' ? message.channel_id : undefined,
          author: typeof message.author_user_id === 'string' ? message.author_user_id : undefined,
          ts: typeof message.message_ts === 'string' ? message.message_ts : undefined,
          text: typeof message.content === 'string' ? message.content.slice(0, 600) : undefined,
          permalink: typeof message.permalink === 'string' ? message.permalink : undefined,
        })),
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)

      // Workspaces installed before the search:read.* scopes were added can't
      // use search until they re-install; tell the agent to answer without it.
      if (message.includes('missing_scope') || message.includes('not_allowed')) {
        return {
          ok: false,
          error:
            'Slack workspace search is unavailable: this workspace must re-install Nuphos to grant the search scopes. Answer with your other tools instead.',
        }
      }
      // Bot-token search needs an action_token from the triggering event. If it
      // is absent or stale (e.g. an install not yet subscribed to the events
      // that carry it), degrade gracefully instead of surfacing a raw error.
      if (message.includes('invalid_action_token') || message.includes('action_token')) {
        return {
          ok: false,
          error:
            'Slack workspace search is unavailable for this message. Answer with your other tools instead.',
        }
      }

      return { ok: false, error: message }
    }
  }

  return {
    react,
    search: SLACK_SEARCH_ENABLED ? search : undefined,
    sender: args.sender,
    notePlanCreated: (plan) => {
      createdPlans.push(plan)
    },
    getCreatedPlans: () => [...createdPlans],
  }
}
