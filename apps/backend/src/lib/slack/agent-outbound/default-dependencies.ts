import { randomUUID } from 'node:crypto'

import { isSlackTriggerNotificationConfigurationCurrent } from '@/lib/agent/trigger-db'
import {
  appendSlackThreadMessage,
  bindSlackAgentThread,
  getSlackAgentThreadBySessionId,
  rebindSlackAgentThreadSession,
  listSlackChannelMappings,
} from '@/lib/slack/agent-bot'
import { postAgentSlackMessage } from '@/lib/slack/agent-message'
import { openSlackDm } from '@/lib/slack/api'
import { getJoinedSlackChannel, listJoinedSlackChannels } from '@/lib/slack/destinations'
import {
  abortSlackIncidentPost,
  completeSlackIncidentPost,
  recordSlackIncidentDelivery,
  reserveSlackIncidentPost,
} from '@/lib/slack/incident-notifications'
import { listIncidentThreadTss } from '@/lib/slack/incident-occurrences'
import {
  getSlackBindingForTeam,
  resolveInstalledWorkspaceBot,
  resolveSlackBotForTeam,
} from '@/lib/slack/installations'
import { resolveSlackSelfMapping } from '@/lib/slack/self-mapping'

import type { SlackOutboundDependencies } from '@/lib/slack/agent-outbound/types'

export const defaultDependencies: SlackOutboundDependencies = {
  getBinding: getSlackBindingForTeam,
  resolveBot: resolveSlackBotForTeam,
  listChannelGrants: async (teamId) =>
    (await listSlackChannelMappings(teamId))
      .filter((mapping) => mapping.enabled)
      .map((mapping) => ({
        slackWorkspaceId: mapping.slackWorkspaceId,
        slackChannelId: mapping.slackChannelId,
      })),
  resolveWorkspaceBot: resolveInstalledWorkspaceBot,
  getSelfMapping: async (slackWorkspaceId, teamId, userId, botToken) =>
    await resolveSlackSelfMapping({
      botToken,
      slackWorkspaceId,
      teamId,
      nuphosUserId: userId,
    }),
  // Keep identity lazy: Bun's module mocks are process-global, and importing
  // identity eagerly made unrelated Slack home tests order-dependent on CI.
  canViewPrivateChannels: async (userId, teamId) => {
    const { getTeamMembership } = await import('@/lib/identity')

    return (await getTeamMembership(userId, teamId))?.role === 'ADMINISTRATOR'
  },
  isTriggerConfigurationCurrent: isSlackTriggerNotificationConfigurationCurrent,
  getThreadBySessionId: getSlackAgentThreadBySessionId,
  bindThread: bindSlackAgentThread,
  appendThreadMessage: appendSlackThreadMessage,
  newSessionId: randomUUID,
  listAlertThreads: listIncidentThreadTss,
  rebindThreadSession: rebindSlackAgentThreadSession,
  listChannels: listJoinedSlackChannels,
  getChannel: getJoinedSlackChannel,
  openDm: openSlackDm,
  // slack_post text is the agent's own CommonMark; normalize it to mrkdwn on
  // the way out. Deliberately at the wiring seam, not inside post.ts: the
  // stored/deduped copy stays the text the agent actually wrote.
  postMessage: postAgentSlackMessage,
  reserveIncident: reserveSlackIncidentPost,
  completeIncident: completeSlackIncidentPost,
  recordIncidentDelivery: recordSlackIncidentDelivery,
  abortIncident: abortSlackIncidentPost,
}
