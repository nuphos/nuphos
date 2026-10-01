// Slash commands (`/nuphos …`). Slack requires an ack within 3 seconds; the
// real response goes through response_url detached, since building it may do
// Slack profile lookups and Mongo queries.
import { AppError } from '@/lib/errors'
import { logError, logEvent } from '@/lib/observability'
import { canVerifySlackRequests, postSlackResponseUrl, verifySlackSignature } from '@/lib/slack/api'
import { resolveSlackBotForWorkspace } from '@/lib/slack/installations'
import { buildPickupCommandResponse } from '@/routes/slack/pickup'

import type { AuthVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

const USAGE_MESSAGE = [
  '*Nuphos commands*',
  '• `/nuphos pickup` — continue one of your recent Nuphos conversations from Slack',
].join('\n')

async function respondToSlashCommand(args: {
  slackWorkspaceId: string
  slackUserId: string
  subcommand: string
  responseUrl: string
}): Promise<void> {
  let response: Record<string, unknown>

  try {
    if (args.subcommand !== 'pickup') {
      response = { response_type: 'ephemeral', text: USAGE_MESSAGE }
    } else {
      const botContext = await resolveSlackBotForWorkspace(args.slackWorkspaceId)

      if (!botContext?.nuphosTeamId) {
        response = {
          response_type: 'ephemeral',
          text: 'Nuphos is not fully installed for this Slack workspace yet.',
        }
      } else {
        response = await buildPickupCommandResponse({
          botToken: botContext.botToken,
          nuphosTeamId: botContext.nuphosTeamId,
          slackWorkspaceId: args.slackWorkspaceId,
          slackUserId: args.slackUserId,
        })
      }
    }
  } catch (err) {
    logError('slack.command.error', err, {
      slack_workspace_id: args.slackWorkspaceId,
      slack_user_id: args.slackUserId,
      subcommand: args.subcommand,
    })
    response = {
      response_type: 'ephemeral',
      text:
        err instanceof AppError
          ? err.message
          : 'Nuphos hit an error while handling this command. Try again in a moment.',
    }
  }
  await postSlackResponseUrl(args.responseUrl, response)
}

export function registerSlackCommandRoutes(slackRoutes: Hono<{ Variables: AuthVariables }>): void {
  slackRoutes.post('/commands', async (c) => {
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

    const params = new URLSearchParams(rawBody)
    const command = params.get('command')
    const slackWorkspaceId = params.get('team_id')
    const slackUserId = params.get('user_id')
    const responseUrl = params.get('response_url')
    const subcommand = (params.get('text') ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? ''

    if (command !== '/nuphos' || !slackWorkspaceId || !slackUserId || !responseUrl) {
      logEvent('info', 'slack.command.unhandled', {
        command: command ?? 'unknown',
        slack_workspace_id: slackWorkspaceId ?? undefined,
      })

      return c.body(null, 200)
    }
    void respondToSlashCommand({
      slackWorkspaceId,
      slackUserId,
      subcommand,
      responseUrl,
    }).catch((err: unknown) => {
      logError('slack.command.dispatch_error', err, {
        slack_workspace_id: slackWorkspaceId,
        slack_user_id: slackUserId,
      })
    })

    // Empty 200 within Slack's 3-second deadline; the ephemeral response
    // arrives through response_url.
    return c.body(null, 200)
  })
}
