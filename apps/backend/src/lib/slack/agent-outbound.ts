import { ObjectId } from 'mongodb'

import {
  createResolveSlackTeamAccess,
  resolveSlackWorkspaceGrants,
} from '@/lib/slack/agent-outbound/access'
import { defaultDependencies } from '@/lib/slack/agent-outbound/default-dependencies'
import { createListSlackDestinations } from '@/lib/slack/agent-outbound/list-destinations'
import { createSlackOutboundPost } from '@/lib/slack/agent-outbound/post'

import type {
  SlackOutboundContext,
  SlackOutboundDependencies,
} from '@/lib/slack/agent-outbound/types'
import type { SlackTriggerNotificationContext } from '@/lib/slack/incident-notifications'

export type { SlackOutboundDestination } from '@/lib/slack/destinations'

export type {
  SlackOutboundContext,
  SlackOutboundDependencies,
} from '@/lib/slack/agent-outbound/types'

/**
 * Build team-scoped outbound Slack hooks for one agent turn. A team qualifies
 * through its own first-party installation (full workspace access), through
 * enabled channel mappings pointing at it from other workspaces'
 * installations (outbound strictly limited to those channels, no DMs), or
 * both at once. Teams with neither get null — the tools stay entirely absent,
 * and the shared legacy fallback is never an agent capability.
 */
export async function createSlackOutboundContext(
  args: {
    userId: string
    conversationId: string
    teamId?: string | null
    triggerNotification?: SlackTriggerNotificationContext
  },
  dependencies: SlackOutboundDependencies = defaultDependencies,
): Promise<SlackOutboundContext | null> {
  if (!args.teamId || !ObjectId.isValid(args.teamId)) return null
  const teamObjectId = new ObjectId(args.teamId)
  const initialBinding = await dependencies.getBinding(teamObjectId)
  const initialGrants = await resolveSlackWorkspaceGrants(
    dependencies,
    args.teamId,
    initialBinding?.slackTeamId,
  )

  if (!initialBinding && initialGrants.length === 0) return null
  const initialWorkspaceId = initialBinding?.slackTeamId ?? null
  const resolveAccess = createResolveSlackTeamAccess({
    dependencies,
    teamObjectId,
    teamId: args.teamId,
    initialWorkspaceId,
  })

  return {
    listDestinations: createListSlackDestinations({
      dependencies,
      userId: args.userId,
      teamId: args.teamId,
      resolveAccess,
    }),
    post: createSlackOutboundPost({ args, dependencies, resolveAccess }),
  }
}
