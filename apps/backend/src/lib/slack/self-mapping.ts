import { AppError } from '@/lib/errors'
import { getTeamMembers } from '@/lib/identity'
import { logEvent } from '@/lib/observability'
import { claimSlackUserMapping, getSlackUserMappingForNuphosUser } from '@/lib/slack/agent-bot'
import { slackApiGet } from '@/lib/slack/api'

import type { SlackUserMapping } from '@/lib/slack/agent-bot'

export type SlackSelfMappingDependencies = {
  getExisting: (
    slackWorkspaceId: string,
    teamId: string,
    nuphosUserId: string,
  ) => Promise<SlackUserMapping | null>
  getMembers: (teamId: string) => Promise<{ id: string; email: string }[]>
  lookupByEmail: (botToken: string, email: string) => Promise<string | null>
  claim: typeof claimSlackUserMapping
}

async function lookupSlackUserByEmail(botToken: string, email: string): Promise<string | null> {
  try {
    const response = await slackApiGet(botToken, 'users.lookupByEmail', { email })

    return response.user && typeof response.user === 'object' ? (response.user.id ?? null) : null
  } catch (err) {
    // Older installations may not have users:read.email yet, and a user may
    // legitimately use a different email in Slack. Both cases simply leave DM
    // unavailable and preserve the manual link path in Settings.
    if (
      err instanceof AppError &&
      /users_not_found|missing_scope|not_allowed_token_type/i.test(err.message)
    ) {
      return null
    }
    throw err
  }
}

const defaultDependencies: SlackSelfMappingDependencies = {
  getExisting: getSlackUserMappingForNuphosUser,
  getMembers: getTeamMembers,
  lookupByEmail: lookupSlackUserByEmail,
  claim: claimSlackUserMapping,
}

/**
 * Resolve the current Nuphos user to the same person in Slack. OAuth already
 * links the installer on new installs; this email-based fallback repairs older
 * installations and lets other team members use "DM me" without copying a
 * Slack member id. A conflicting existing mapping is never overwritten.
 */
export async function resolveSlackSelfMapping(
  args: {
    botToken: string
    slackWorkspaceId: string
    teamId: string
    nuphosUserId: string
  },
  dependencies: SlackSelfMappingDependencies = defaultDependencies,
): Promise<SlackUserMapping | null> {
  const existing = await dependencies.getExisting(
    args.slackWorkspaceId,
    args.teamId,
    args.nuphosUserId,
  )

  if (existing) return existing

  const member = (await dependencies.getMembers(args.teamId)).find(
    (candidate) => candidate.id === args.nuphosUserId,
  )
  const email = member?.email.trim().toLowerCase()

  if (!email) return null

  const slackUserId = await dependencies.lookupByEmail(args.botToken, email)

  if (!slackUserId) return null

  const mapping = await dependencies.claim({
    slackWorkspaceId: args.slackWorkspaceId,
    slackUserId,
    teamId: args.teamId,
    nuphosUserId: args.nuphosUserId,
    createdBy: 'auto:nuphos-email',
  })

  if (!mapping) {
    logEvent('warn', 'slack.agent.user_mapping.auto_link_conflict', {
      team_id: args.teamId,
      slack_workspace_id: args.slackWorkspaceId,
      slack_user_id: slackUserId,
      nuphos_user_id: args.nuphosUserId,
    })

    return null
  }
  logEvent('info', 'slack.agent.user_mapping.auto_link', {
    team_id: args.teamId,
    slack_workspace_id: args.slackWorkspaceId,
    slack_user_id: slackUserId,
    nuphos_user_id: args.nuphosUserId,
    direction: 'nuphos_to_slack',
  })

  return mapping
}
