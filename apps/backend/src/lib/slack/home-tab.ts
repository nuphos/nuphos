import { ObjectId } from 'mongodb'

import { canUseAllowList } from '@/lib/byos/access'
import { getTeamMembers, getTeamsByIds } from '@/lib/identity'
import { listSlackChannelMappings } from '@/lib/slack/agent-bot'
import {
  HOME_FOOTER_BLOCK,
  HOME_INTRO_BLOCKS,
  connectionBlocks,
  credentialBlocks,
  howToUseBlocks,
  linkedChannelBlocks,
} from '@/lib/slack/home-tab/blocks'
import { teamByosBindings } from '@/models'

import type { SlackHomeCredentialGroup, SlackHomeViewModel } from '@/lib/slack/home-tab/blocks'
import type { BindingAccess } from '@/models'

export { HOME_REFRESH_ACTION } from '@/lib/slack/home-tab/blocks'

export type { SlackHomeCredentialGroup, SlackHomeViewModel } from '@/lib/slack/home-tab/blocks'

// Which of the team's cloud credential bindings this Nuphos user may use,
// grouped by provider. Applies the same per-binding member allowlist the REST
// routes enforce (lib/byos/access.ts); bindings without an access field are
// team-wide by default.
export async function listAccessibleTeamCredentials(
  teamId: string,
  nuphosUserId: string,
): Promise<SlackHomeCredentialGroup[]> {
  if (!ObjectId.isValid(teamId)) return []
  const doc = await teamByosBindings().findOne({ _id: new ObjectId(teamId) })

  if (!doc) return []

  const can = (access?: BindingAccess) => canUseAllowList(access?.memberAllowList, nuphosUserId)
  const groups: SlackHomeCredentialGroup[] = []
  const add = (provider: string, entries: string[]) => {
    if (entries.length) groups.push({ provider, entries })
  }

  add(
    'AWS',
    (doc.awsRoles ?? []).filter((b) => can(b.access)).map((b) => b.roleArn),
  )
  add(
    'Google Cloud',
    (doc.gcpServiceAccounts ?? [])
      .filter((b) => can(b.access))
      .map((b) => `${b.serviceAccountEmail} (${b.projectId})`),
  )
  add(
    'Tencent Cloud',
    (doc.tencentAccounts ?? []).filter((b) => can(b.access)).map((b) => b.label),
  )
  add(
    'Alibaba Cloud',
    (doc.aliyunAccounts ?? []).filter((b) => can(b.access)).map((b) => b.label),
  )
  add(
    'Volcengine',
    (doc.volcengineAccounts ?? []).filter((b) => can(b.access)).map((b) => b.label),
  )
  add(
    'Huawei Cloud',
    (doc.huaweiAccounts ?? []).filter((b) => can(b.access)).map((b) => b.label),
  )
  add(
    'Cloudflare',
    (doc.cloudflareAccounts ?? []).map((b) => b.accountName ?? b.accountId),
  )
  add(
    'Linode',
    (doc.linodeAccounts ?? []).filter((b) => can(b.access)).map((b) => b.label),
  )
  add(
    'Hetzner',
    (doc.hetznerAccounts ?? []).filter((b) => can(b.access)).map((b) => b.label),
  )
  add(
    'Zeabur',
    (doc.zeaburProviders ?? []).map(
      (b) => b.identities.map((identity) => identity.name).join(', ') || 'Zeabur account',
    ),
  )

  return groups
}

export function buildSlackHomeViewFromModel(model: SlackHomeViewModel): Record<string, unknown> {
  return {
    type: 'home',
    blocks: [
      ...HOME_INTRO_BLOCKS,
      { type: 'divider' },
      ...connectionBlocks(model),
      ...linkedChannelBlocks(model),
      { type: 'divider' },
      ...credentialBlocks(model),
      { type: 'divider' },
      ...howToUseBlocks(model),
      HOME_FOOTER_BLOCK,
    ],
  }
}

// Shown when the Slack workspace has no Nuphos team binding (including the
// legacy env-token install, which carries no team).
export function buildDisconnectedSlackHomeView(): Record<string, unknown> {
  return {
    type: 'home',
    blocks: [
      ...HOME_INTRO_BLOCKS,
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: "*This Slack workspace isn't connected to a Nuphos team yet.*\nConnect it from the Nuphos desktop app: *Settings → Slack → Connect workspace*. Once connected, this page shows your team, linked channels, and the cloud credentials available to you.",
        },
      },
      HOME_FOOTER_BLOCK,
    ],
  }
}

// Assembles the per-viewer model for a connected workspace and renders it.
export async function buildConnectedSlackHomeView(args: {
  slackWorkspaceId: string
  slackTeamName: string
  botUserId: string
  nuphosTeamId: string
  // Null when the viewer has no user mapping yet.
  nuphosUserId: string | null
}): Promise<Record<string, unknown>> {
  const [teams, members, channelMappings, credentials] = await Promise.all([
    getTeamsByIds([args.nuphosTeamId]),
    args.nuphosUserId ? getTeamMembers(args.nuphosTeamId) : Promise.resolve([]),
    listSlackChannelMappings(args.nuphosTeamId),
    args.nuphosUserId
      ? listAccessibleTeamCredentials(args.nuphosTeamId, args.nuphosUserId)
      : Promise.resolve([]),
  ])
  // A mapping can outlive team membership; a viewer whose Nuphos user is no
  // longer a member renders as unlinked (same gate the message handlers apply).
  const member = args.nuphosUserId
    ? (members.find((entry) => entry.id === args.nuphosUserId) ?? null)
    : null

  return buildSlackHomeViewFromModel({
    slackTeamName: args.slackTeamName,
    botUserId: args.botUserId,
    teamName: teams[0]?.name ?? 'Unknown team',
    viewer: member ? { name: member.name, email: member.email, role: member.role ?? null } : null,
    linkedChannelIds: channelMappings
      .filter((mapping) => mapping.slackWorkspaceId === args.slackWorkspaceId && mapping.enabled)
      .map((mapping) => mapping.slackChannelId),
    credentials,
  })
}
