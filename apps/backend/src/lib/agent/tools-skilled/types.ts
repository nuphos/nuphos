export type SlackCreatedPlan = {
  planId: string
  title: string
  overview?: string
}

export type SlackReactToolInput = {
  action: 'add' | 'remove'
  // Slack emoji short name without colons, e.g. 'eyes', 'tada', 'white_check_mark'.
  name: string
}

export type SlackReactToolResult = {
  ok: boolean
  action: SlackReactToolInput['action']
  name: string
  error?: string
}

export type SlackSearchToolInput = {
  query: string
  limit?: number
}

export type SlackSearchToolResult = {
  ok: boolean
  results?: {
    channel?: string
    author?: string
    ts?: string
    text?: string
    permalink?: string
  }[]
  error?: string
}

export type ExplicitUserDecision = {
  category: 'preference' | 'approval' | 'credential' | 'integration' | 'risk_tradeoff'
  question: string
  options?: string[]
}

// Slack-originated turns no longer expose an outbound reply tool: the model's
// visible text streams to the Slack thread and its tool calls become task
// cards automatically (see lib/slack/stream-sink.ts). This context carries the
// remaining Slack-specific hooks.
export type SlackReplyToolContext = {
  // Set when the turn was typed in the Nuphos app on a Slack-bound
  // conversation and is being mirrored into the thread, rather than received
  // from Slack itself. Switches the system-prompt Slack block to the
  // dual-surface variant (routes/agent/chat-channel-messages.ts).
  nuphosOriginated?: boolean
  // Who sent the message that started this turn. Rendered transcripts show
  // display names only, so the system prompt uses this to hand the model the
  // Slack user id it needs to @-mention the sender.
  sender?: { slackUserId: string; displayName?: string | null }
  // Lets the Slack turn record plans created mid-run, so the thread gets a
  // review/approve card for each proposed plan at the end of the turn.
  notePlanCreated?: (plan: SlackCreatedPlan) => void
  // Same, for permission-grant proposals. Only the id: the card is built from
  // the stored proposal, so the model's tool input never shapes what an
  // administrator sees before approving.
  // Adds/removes an emoji reaction on the user message that started the turn.
  // Present only for Slack, so slack_react is
  // registered only when this is defined.
  react?: (input: SlackReactToolInput) => Promise<SlackReactToolResult>
  // Searches the connected Slack workspace via assistant.search.context.
  // Reports search-unavailable (ok:false) when the workspace's bot token lacks
  // the search:read.* scopes instead of throwing.
  search?: (input: SlackSearchToolInput) => Promise<SlackSearchToolResult>
}

export type LarkReplyToolContext = {
  sender?: { openId: string; displayName?: string | null }
}
