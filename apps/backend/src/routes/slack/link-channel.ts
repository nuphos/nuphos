import { ObjectId } from 'mongodb'

import { getTeamMembership } from '@/lib/identity'
import { logError, logEvent } from '@/lib/observability'
import { openSlackDm, postSlackMessage, postSlackResponseUrl } from '@/lib/slack/api'
import { resolveSlackBotForWorkspace } from '@/lib/slack/installations'
import {
  announceChannelLink,
  buildChannelLinkedInteractionResponse,
  linkChannelFromSlackInteraction,
  resolveNuphosUserForSlackActor,
} from '@/lib/slack/onboarding'
import { publishHomeTabForUser } from '@/routes/slack/home'

import type { SlackInteractionPayload } from '@/routes/slack/types'

// Everything behind the nuphos_link_channel ack: gate checks, the
// conversations.info probe, the mapping upsert, and result delivery. Kept out
// of handleSlackInteraction so the interaction route can ack within Slack's
// 3-second deadline and run this detached whenever an out-of-band delivery
// path exists.
export async function handleLinkChannelInteraction(args: {
  payload: SlackInteractionPayload
  slackWorkspaceId: string
  slackUserId: string
  channelId: string
  fromPicker: boolean
}): Promise<Record<string, unknown> | null> {
  const { payload, slackWorkspaceId, slackUserId, channelId, fromPicker } = args
  // Slack ignores the HTTP ack body for message block_actions — deliver
  // through response_url when present, and fall back to the ack body only
  // when it is missing.
  const deliver = async (
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> => {
    if (payload.response_url) {
      try {
        await postSlackResponseUrl(payload.response_url, body)

        return null
      } catch (err) {
        logError('slack.onboarding.channel_link.response_url_error', err, {
          slack_workspace_id: slackWorkspaceId,
          slack_channel_id: channelId,
        })
      }
    }

    return body
  }

  const botContext = await resolveSlackBotForWorkspace(slackWorkspaceId)

  if (!botContext?.nuphosTeamId) {
    return await deliver({
      response_type: 'ephemeral',
      replace_original: false,
      text: 'Nuphos is not installed for this Slack workspace yet.',
    })
  }

  const linkedByNuphosUserId = await resolveNuphosUserForSlackActor({
    slackWorkspaceId,
    nuphosTeamId: new ObjectId(botContext.nuphosTeamId),
    slackUserId,
  })

  // Channel mappings are team-level config: mirror the REST route's gate
  // (PUT /slack/mappings → requireTeamAdmin). A user mapping only proves the
  // actor linked their account — require the mapped Nuphos user to still be a
  // team ADMINISTRATOR before persisting. The install-welcome DM flow keeps
  // working: /slack-installations/start-oauth already requires ADMINISTRATOR,
  // and the installer is auto-linked to that requester.
  const fromHomeTab = payload.view?.type === 'home'
  const actorMembership = linkedByNuphosUserId
    ? await getTeamMembership(linkedByNuphosUserId, botContext.nuphosTeamId)
    : null

  if (actorMembership?.role !== 'ADMINISTRATOR') {
    const adminHint = linkedByNuphosUserId
      ? 'Only team administrators can link channels to Nuphos.'
      : 'Your Slack account is not linked to a Nuphos administrator. Link it in Nuphos → Settings → Slack — note that only team administrators can link channels.'

    logEvent('info', 'slack.onboarding.channel_link.denied', {
      slack_workspace_id: slackWorkspaceId,
      slack_user_id: slackUserId,
      slack_channel_id: channelId,
      team_id: botContext.nuphosTeamId,
      linked: Boolean(linkedByNuphosUserId),
    })
    if (fromHomeTab) {
      // No response_url on view actions — deliver the denial by DM.
      void openSlackDm(botContext.botToken, slackUserId)
        .then((dmChannelId) =>
          postSlackMessage({ token: botContext.botToken, channel: dmChannelId, text: adminHint }),
        )
        .catch((err: unknown) => {
          logError('slack.home.link_channel_dm.error', err, {
            slack_workspace_id: slackWorkspaceId,
            slack_user_id: slackUserId,
          })
        })

      return null
    }

    return await deliver({ response_type: 'ephemeral', replace_original: false, text: adminHint })
  }

  const linkChannel = () =>
    linkChannelFromSlackInteraction({
      botToken: botContext.botToken,
      slackWorkspaceId,
      nuphosTeamId: botContext.nuphosTeamId,
      channelId,
      linkedBySlackUserId: slackUserId,
      linkedByNuphosUserId: linkedByNuphosUserId ?? undefined,
    })
  const inviteHint = `I couldn't access <#${channelId}>. If it's a private channel, run \`/invite @Nuphos\` there first, then pick it again.`

  // Home-tab select: no response_url, so success shows up by re-publishing the
  // view (the channel appears under "Linked channels") and failure guidance is
  // delivered by DM. Runs detached to stay inside the 3-second ack window.
  if (fromHomeTab) {
    void (async () => {
      try {
        await linkChannel()
      } catch (err) {
        logError('slack.onboarding.channel_link.error', err, {
          slack_workspace_id: slackWorkspaceId,
          slack_channel_id: channelId,
        })
        try {
          const dmChannelId = await openSlackDm(botContext.botToken, slackUserId)

          await postSlackMessage({
            token: botContext.botToken,
            channel: dmChannelId,
            text: inviteHint,
          })
        } catch (dmErr) {
          logError('slack.home.link_channel_dm.error', dmErr, {
            slack_workspace_id: slackWorkspaceId,
            slack_user_id: slackUserId,
          })
        }
      }
      await publishHomeTabForUser({ slackWorkspaceId, slackUserId }).catch((err: unknown) => {
        logError('slack.home.republish.error', err, {
          slack_workspace_id: slackWorkspaceId,
          slack_user_id: slackUserId,
        })
      })
    })()

    return null
  }

  try {
    const { channelName } = await linkChannel()
    // Say hello in the channel itself. Linking from a DM is invisible to
    // everyone else in that channel, and a missing invite would otherwise only
    // surface the first time someone mentions the bot and gets nothing back.
    // Skipped when the click came from a button already posted in the channel.
    const announcement = fromPicker
      ? await announceChannelLink({ botToken: botContext.botToken, channelId })
      : undefined
    // The DM picker keeps its "link more channels" card; the in-channel button
    // prompt is replaced with a plain confirmation.
    const confirmation = fromPicker
      ? buildChannelLinkedInteractionResponse({ channelId, channelName, announcement })
      : {
          replace_original: true,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Channel linked:* <#${channelId}> — mention me again and I'll get to work.`,
              },
            },
          ],
        }

    return await deliver(confirmation)
  } catch (err) {
    logError('slack.onboarding.channel_link.error', err, {
      slack_workspace_id: slackWorkspaceId,
      slack_channel_id: channelId,
    })

    return await deliver({
      response_type: 'ephemeral',
      replace_original: false,
      text: inviteHint,
    })
  }
}
