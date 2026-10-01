export type ConversationActivityOrigin = 'nuphos' | 'slack' | 'trigger' | 'mcp' | 'unknown'

export type ConversationActivitySource = {
  origin: ConversationActivityOrigin
  linkedSlackThread: boolean
}

type SlackThreadActivity = {
  // Legacy Slack-originated bindings predate this field. The caller conveys
  // binding existence with the object itself, so a missing origin on an
  // existing row is intentionally treated as Slack-originated.
  origin?: 'slack' | 'agent_notification' | 'user_pickup'
}

// Bindings the agent or the user attached to an ALREADY-running conversation.
// These must not reclassify the conversation's creation origin — a desktop
// chat picked up in Slack is still a desktop chat.
const ATTACHED_THREAD_ORIGINS: ReadonlySet<string> = new Set(['agent_notification', 'user_pickup'])

/**
 * Normalize storage-level conversation metadata into a stable API contract.
 * Creation origin and delivery surface are separate: a trigger conversation
 * can also be linked to Slack, so linkedSlackThread must not overwrite origin.
 */
export function normalizeConversationActivitySource(
  source: string | undefined,
  slackThread?: SlackThreadActivity | null,
): ConversationActivitySource {
  const linkedSlackThread = !!slackThread
  const slackOriginated =
    source?.startsWith('slack.') ||
    (linkedSlackThread && !ATTACHED_THREAD_ORIGINS.has(slackThread.origin ?? ''))

  let origin: ConversationActivityOrigin = 'unknown'

  if (slackOriginated) origin = 'slack'
  else if (source === 'agent.trigger' || source?.startsWith('agent.trigger.')) origin = 'trigger'
  else if (source === 'app' || source?.startsWith('app.')) origin = 'nuphos'
  else if (source === 'mcp' || source?.startsWith('mcp.')) origin = 'mcp'

  return { origin, linkedSlackThread }
}
