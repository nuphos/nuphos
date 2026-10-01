import type {
  SlackOutboundDependencies,
  SlackTeamAccess,
  SlackWorkspaceGrant,
} from '@/lib/slack/agent-outbound/types'
import type { ObjectId } from 'mongodb'

// Grants in the installation's own workspace are redundant (the joined
// channel list already covers it), so they are excluded up front.
export async function resolveSlackWorkspaceGrants(
  dependencies: SlackOutboundDependencies,
  teamId: string,
  excludeWorkspaceId?: string,
): Promise<SlackWorkspaceGrant[]> {
  const grants = await dependencies.listChannelGrants(teamId)
  const byWorkspace = new Map<string, Set<string>>()

  for (const grant of grants) {
    if (grant.slackWorkspaceId === excludeWorkspaceId) continue
    const channels = byWorkspace.get(grant.slackWorkspaceId) ?? new Set<string>()

    channels.add(grant.slackChannelId)
    byWorkspace.set(grant.slackWorkspaceId, channels)
  }
  // Deterministic order: most granted channels first, workspace id tiebreak.
  const ranked = [...byWorkspace.entries()].sort(
    (a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]),
  )
  const resolved: SlackWorkspaceGrant[] = []

  for (const [workspaceId, channelIds] of ranked) {
    const bot = await dependencies.resolveWorkspaceBot(workspaceId)

    if (!bot) continue
    resolved.push({
      workspaceId,
      workspaceName: bot.workspaceName,
      botToken: bot.botToken,
      channelIds,
    })
  }

  return resolved
}

export function createResolveSlackTeamAccess(input: {
  dependencies: SlackOutboundDependencies
  teamObjectId: ObjectId
  teamId: string
  initialWorkspaceId: string | null
}): () => Promise<SlackTeamAccess> {
  const { dependencies, teamObjectId, teamId, initialWorkspaceId } = input

  return async () => {
    // Resolve again at execution time so uninstalling Slack — or unlinking the
    // granted channels — between model planning and the tool call fails closed
    // instead of using a stale token or a revoked grant.
    const binding = await dependencies.getBinding(teamObjectId)

    if (initialWorkspaceId) {
      if (!binding || binding.slackTeamId !== initialWorkspaceId) {
        throw new Error('Slack is no longer connected to this Nuphos team')
      }
    } else if (binding) {
      throw new Error('Slack connectivity for this Nuphos team changed while the turn was running')
    }
    let installation: SlackTeamAccess['installation'] = null

    if (binding) {
      const bot = await dependencies.resolveBot(teamObjectId)

      if (!bot || bot.binding.slackTeamId !== binding.slackTeamId) {
        throw new Error('Slack is not available for this Nuphos team')
      }
      installation = {
        workspaceId: binding.slackTeamId,
        workspaceName: binding.slackTeamName,
        botToken: bot.botToken,
      }
    }
    const grants = await resolveSlackWorkspaceGrants(dependencies, teamId, binding?.slackTeamId)

    if (!installation && grants.length === 0) {
      throw new Error('Slack is no longer connected to this Nuphos team')
    }

    return { installation, grants }
  }
}
