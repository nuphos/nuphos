import { getSlackBindingByWorkspaceId } from '@/lib/slack/installations'

import type { SlackChannelMapping } from '@/lib/slack/agent-bot'
import type { SlackWorkspaceBinding } from '@/models'

export type SlackLinkedChannelsSummary = {
  count: number
  grantWorkspaces: { id: string; name: string | null }[]
}

type ResolveWorkspaceName = (slackWorkspaceId: string) => Promise<string | null>

const installedWorkspaceName: ResolveWorkspaceName = async (slackWorkspaceId) =>
  (await getSlackBindingByWorkspaceId(slackWorkspaceId))?.binding.slackTeamName ?? null

/**
 * A mapping is only live Slack access while some team's installation serves
 * its workspace. Mappings left behind by an uninstall (or pointing at a
 * workspace nobody installed) are excluded, so the connectors page never shows
 * "linked channels" that have no bot behind them.
 */
export async function summarizeSlackLinkedChannels(
  mappings: SlackChannelMapping[],
  ownBinding: Pick<SlackWorkspaceBinding, 'slackTeamId' | 'slackTeamName'> | null,
  resolveWorkspaceName: ResolveWorkspaceName = installedWorkspaceName,
): Promise<SlackLinkedChannelsSummary> {
  const enabled = mappings.filter((mapping) => mapping.enabled)
  const workspaceIds = [...new Set(enabled.map((mapping) => mapping.slackWorkspaceId))]
  const installedNames = new Map(
    await Promise.all(
      workspaceIds.map(async (id): Promise<[string, string | null]> => [
        id,
        id === ownBinding?.slackTeamId ? ownBinding.slackTeamName : await resolveWorkspaceName(id),
      ]),
    ),
  )
  const isInstalled = (id: string) => typeof installedNames.get(id) === 'string'

  return {
    count: enabled.filter((mapping) => isInstalled(mapping.slackWorkspaceId)).length,
    grantWorkspaces: workspaceIds
      .filter((id) => id !== ownBinding?.slackTeamId && isInstalled(id))
      .map((id) => ({ id, name: installedNames.get(id) ?? null })),
  }
}
