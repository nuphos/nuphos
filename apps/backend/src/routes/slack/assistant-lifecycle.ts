import { logEvent } from '@/lib/observability'
import { markSlackEvent, setSlackAssistantThreadContext } from '@/lib/slack/agent-bot'
import { postSlackMessage, setSlackAssistantSuggestedPrompts } from '@/lib/slack/api'
import { resolveSlackBotForWorkspace } from '@/lib/slack/installations'
import {
  ASSISTANT_GREETING,
  ASSISTANT_PROMPTS_TITLE,
  buildSuggestedPrompts,
} from '@/routes/slack/status'

import type { SlackEventEnvelope } from '@/routes/slack/types'

// User started a new conversation in the app's Chat tab (assistant_view).
// Fires once per fresh thread — greet, offer the suggested-prompt chips, and
// remember what the user was viewing so "this channel" questions resolve.
// All Slack calls are best-effort: a transient error must not fail the event
// (which would make Slack retry it).
export async function handleAssistantThreadStarted(envelope: SlackEventEnvelope): Promise<void> {
  const event = envelope.event
  const eventId = envelope.event_id
  const slackWorkspaceId = envelope.team_id

  if (!event || !eventId || !slackWorkspaceId) return

  const channelId = event.assistant_thread?.channel_id
  const threadTs = event.assistant_thread?.thread_ts

  if (!channelId || !threadTs) {
    await markSlackEvent(eventId, 'ignored')

    return
  }

  const botContext = await resolveSlackBotForWorkspace(slackWorkspaceId)

  if (!botContext) {
    await markSlackEvent(eventId, 'failed', 'No Slack bot configured for this workspace')

    return
  }
  const token = botContext.botToken

  // Validate installation completeness before greeting: if nuphosTeamId is
  // absent the workspace was OAuth'd but not fully set up, so the user would
  // see a welcome prompt and then hit an error on their very first message.
  // Surface the problem immediately instead.
  if (!botContext.nuphosTeamId) {
    try {
      await postSlackMessage({
        token,
        channel: channelId,
        threadTs,
        text: 'Nuphos is not fully installed for this Slack workspace yet. Ask an admin to complete the installation.',
      })
    } catch (err) {
      logEvent('warn', 'slack.assistant.install_error_msg_failed', {
        slack_channel_id: channelId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    await markSlackEvent(eventId, 'completed')

    return
  }

  const contextChannelId = event.assistant_thread?.context?.channel_id

  try {
    await setSlackAssistantThreadContext({
      slackWorkspaceId,
      slackChannelId: channelId,
      slackThreadTs: threadTs,
      contextChannelId,
    })
  } catch (err) {
    logEvent('warn', 'slack.assistant.context_persist_failed', {
      slack_channel_id: channelId,
      slack_thread_ts: threadTs,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  try {
    await postSlackMessage({ token, channel: channelId, threadTs, text: ASSISTANT_GREETING })
  } catch (err) {
    logEvent('warn', 'slack.assistant.greeting_failed', {
      slack_channel_id: channelId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  try {
    await setSlackAssistantSuggestedPrompts({
      token,
      channelId,
      threadTs,
      prompts: buildSuggestedPrompts(contextChannelId),
      title: ASSISTANT_PROMPTS_TITLE,
    })
  } catch (err) {
    logEvent('warn', 'slack.assistant.prompts_failed', {
      slack_channel_id: channelId,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  await markSlackEvent(eventId, 'completed')
}

// The user navigated to a different channel while an assistant thread stayed
// open in the split view. Persist the new context so the NEXT message in that
// thread carries the right "currently viewing" hint.
export async function handleAssistantThreadContextChanged(
  envelope: SlackEventEnvelope,
): Promise<void> {
  const event = envelope.event
  const eventId = envelope.event_id
  const slackWorkspaceId = envelope.team_id

  if (!event || !eventId || !slackWorkspaceId) return

  const channelId = event.assistant_thread?.channel_id
  const threadTs = event.assistant_thread?.thread_ts

  if (!channelId || !threadTs) {
    await markSlackEvent(eventId, 'ignored')

    return
  }

  // Best-effort like the started handler: a transient DB error must not fail
  // the event (Slack would retry it); the context hint is a nice-to-have.
  try {
    await setSlackAssistantThreadContext({
      slackWorkspaceId,
      slackChannelId: channelId,
      slackThreadTs: threadTs,
      contextChannelId: event.assistant_thread?.context?.channel_id,
    })
  } catch (err) {
    logEvent('warn', 'slack.assistant.context_persist_failed', {
      slack_channel_id: channelId,
      slack_thread_ts: threadTs,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  await markSlackEvent(eventId, 'completed')
}
