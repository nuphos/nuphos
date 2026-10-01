import { AppError } from '@/lib/errors'
import { logError } from '@/lib/observability'
import { claimSlackEvent, markSlackEvent, refreshSlackEventClaim } from '@/lib/slack/agent-bot'
import { canVerifySlackRequests, verifySlackSignature } from '@/lib/slack/api'
import { resolveSlackBotForWorkspace } from '@/lib/slack/installations'
import {
  handleAssistantThreadContextChanged,
  handleAssistantThreadStarted,
} from '@/routes/slack/assistant-lifecycle'
import { handleAssistantMessage } from '@/routes/slack/assistant-message'
import { handleAppHomeOpened } from '@/routes/slack/home'
import { handleAppMention } from '@/routes/slack/mention'
import { postThreadMessage } from '@/routes/slack/shared'
import { handleThreadMessage } from '@/routes/slack/thread-message'

import type { AuthVariables } from '@/middleware/auth'
import type { SlackEventEnvelope, SlackRuntime } from '@/routes/slack/types'
import type { Hono } from 'hono'

async function handleSlackEvent(envelope: SlackEventEnvelope): Promise<void> {
  const type = envelope.event?.type

  if (type === 'app_home_opened') {
    await handleAppHomeOpened(envelope)

    return
  }
  if (type === 'app_mention') {
    await handleAppMention(envelope)

    return
  }
  if (type === 'assistant_thread_started') {
    await handleAssistantThreadStarted(envelope)

    return
  }
  if (type === 'assistant_thread_context_changed') {
    await handleAssistantThreadContextChanged(envelope)

    return
  }
  if (type === 'message') {
    // DM messages in the app's Chat/History tabs carry channel_type 'im';
    // everything else is a channel thread reply.
    if (envelope.event?.channel_type === 'im') {
      await handleAssistantMessage(envelope)

      return
    }
    await handleThreadMessage(envelope)

    return
  }
  if (envelope.event_id) await markSlackEvent(envelope.event_id, 'ignored')
}

async function handleSlackEventWithLease(envelope: SlackEventEnvelope): Promise<void> {
  const eventId = envelope.event_id

  if (!eventId) return await handleSlackEvent(envelope)
  const timer = setInterval(() => {
    void refreshSlackEventClaim(eventId).catch((err: unknown) => {
      logError('slack.event.claim_refresh_error', err, { event_id: eventId })
    })
  }, 60_000)

  try {
    await handleSlackEvent(envelope)
  } finally {
    clearInterval(timer)
  }
}

export function registerSlackEventRoutes(slackRoutes: Hono<{ Variables: AuthVariables }>): void {
  slackRoutes.post('/events', async (c) => {
    if (!canVerifySlackRequests()) {
      throw new AppError(503, 'slack_not_configured', 'SLACK_SIGNING_SECRET is not configured')
    }

    const rawBody = await c.req.text()
    const valid = verifySlackSignature(
      rawBody,
      c.req.header('X-Slack-Request-Timestamp'),
      c.req.header('X-Slack-Signature'),
    )

    if (!valid) throw new AppError(401, 'invalid_signature', 'Invalid Slack signature')

    const envelope = JSON.parse(rawBody) as SlackEventEnvelope

    if (envelope.type === 'url_verification') {
      return c.text(envelope.challenge ?? '')
    }
    if (envelope.type !== 'event_callback') {
      return c.json({ ok: true, ignored: true })
    }

    const event = envelope.event
    const threadTs = event?.thread_ts ?? event?.ts

    if (envelope.event_id) {
      const claimed = await claimSlackEvent({
        eventId: envelope.event_id,
        slackWorkspaceId: envelope.team_id,
        slackChannelId: event?.channel,
        slackThreadTs: threadTs,
        eventTs: event?.event_ts,
      })

      if (!claimed) return c.json({ ok: true, duplicate: true })
    }

    void handleSlackEventWithLease(envelope).catch(async (err: unknown) => {
      logError('slack.agent.event.error', err, {
        event_id: envelope.event_id,
        team_id: envelope.team_id,
        slack_channel_id: event?.channel,
        slack_thread_ts: threadTs,
      })
      if (envelope.event_id) {
        await markSlackEvent(
          envelope.event_id,
          'failed',
          err instanceof Error ? err.message : String(err),
        )
      }
      if (event?.channel && threadTs && envelope.team_id) {
        try {
          const botContext = await resolveSlackBotForWorkspace(envelope.team_id)

          if (botContext) {
            const runtime: SlackRuntime = {
              botToken: botContext.botToken,
              botUserId: botContext.botUserId,
            }

            await postThreadMessage(
              runtime,
              event.channel,
              threadTs,
              'Nuphos hit an error while handling this request. The team has enough trace metadata to investigate.',
            )
          }
        } catch (postErr) {
          logError('slack.agent.error_reply.error', postErr, {
            event_id: envelope.event_id,
            slack_channel_id: event.channel,
            slack_thread_ts: threadTs,
          })
        }
      }
    })

    return c.json({ ok: true })
  })
}
