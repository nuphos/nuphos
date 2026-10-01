import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import * as identity from '@/lib/identity'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useModels } from '@/lib/test/doubles/models'
import { useSlackAgentBot } from '@/lib/test/doubles/slack-agent-bot'

// The builders under test only need the byos-bindings collection and the
// identity/channel lookups; mock those module boundaries so the test never
// touches Mongo or config.
let byosDoc: Record<string, unknown> | null = null
let teamsById: Record<string, unknown>[] = []
let members: Record<string, unknown>[] = []
let channelMappings: Record<string, unknown>[] = []

useModels({
  teamByosBindings: () => ({
    findOne: async () => byosDoc,
  }),
})

useIdentity({ getTeamsByIds: async () => teamsById, getTeamMembers: async () => members })

useSlackAgentBot({ listSlackChannelMappings: async () => channelMappings })

const {
  buildConnectedSlackHomeView,
  buildDisconnectedSlackHomeView,
  buildSlackHomeViewFromModel,
  listAccessibleTeamCredentials,
} = await import('@/lib/slack/home-tab')

const TEAM_ID = new ObjectId().toHexString()

function viewText(view: Record<string, unknown>): string {
  return JSON.stringify(view.blocks)
}

beforeEach(() => {
  byosDoc = null
  teamsById = []
  members = []
  channelMappings = []
})

describe('listAccessibleTeamCredentials', () => {
  test('applies per-binding member allowlists and groups by provider', async () => {
    byosDoc = {
      awsRoles: [
        { roleArn: 'arn:aws:iam::1:role/AllowAll' },
        {
          roleArn: 'arn:aws:iam::1:role/OnlyOther',
          access: { memberAllowList: ['someone-else'], updatedAt: new Date(), updatedBy: 'x' },
        },
        {
          roleArn: 'arn:aws:iam::1:role/AllowsMe',
          access: { memberAllowList: ['user-1'], updatedAt: new Date(), updatedBy: 'x' },
        },
      ],
      gcpServiceAccounts: [
        { serviceAccountEmail: 'sa@proj.iam.gserviceaccount.com', projectId: 'proj' },
      ],
      cloudflareAccounts: [{ accountId: 'cf-1', accountName: null }],
      zeaburProviders: [{ identities: [{ name: 'Acme' }, { name: 'Acme Team' }] }],
    }
    const groups = await listAccessibleTeamCredentials(TEAM_ID, 'user-1')

    expect(groups).toEqual([
      {
        provider: 'AWS',
        entries: ['arn:aws:iam::1:role/AllowAll', 'arn:aws:iam::1:role/AllowsMe'],
      },
      { provider: 'Google Cloud', entries: ['sa@proj.iam.gserviceaccount.com (proj)'] },
      { provider: 'Cloudflare', entries: ['cf-1'] },
      { provider: 'Zeabur', entries: ['Acme, Acme Team'] },
    ])
  })

  test('returns empty for a missing bindings doc or invalid team id', async () => {
    expect(await listAccessibleTeamCredentials(TEAM_ID, 'user-1')).toEqual([])
    expect(await listAccessibleTeamCredentials('not-an-object-id', 'user-1')).toEqual([])
  })
})

describe('buildSlackHomeViewFromModel', () => {
  const baseModel = {
    slackTeamName: 'Acme Slack',
    botUserId: 'B123',
    teamName: 'Acme',
    linkedChannelIds: ['C1', 'C2'],
  }

  test('linked viewer sees account, role, channels, and credentials', () => {
    const view = buildSlackHomeViewFromModel({
      ...baseModel,
      viewer: { name: 'Jane', email: 'jane@acme.dev', role: 'ADMINISTRATOR' },
      credentials: [{ provider: 'AWS', entries: ['arn:aws:iam::1:role/NuphosRole'] }],
    })
    const text = viewText(view)

    expect(view.type).toBe('home')
    expect(text).toContain('Jane')
    expect(text).toContain('jane@acme.dev')
    expect(text).toContain('Administrator')
    expect(text).toContain('<#C1>')
    expect(text).toContain('<#C2>')
    expect(text).toContain('arn:aws:iam::1:role/NuphosRole')
    expect(text).toContain('<@B123>')
    expect(text).toContain('nuphos_home_refresh')
    expect(text).toContain('nuphos_link_channel')
  })

  test('unlinked viewer gets link guidance instead of credentials', () => {
    const view = buildSlackHomeViewFromModel({
      ...baseModel,
      viewer: null,
      credentials: [],
    })
    const text = viewText(view)

    expect(text).toContain('Not linked')
    expect(text).toContain('Link your Nuphos account to see which credentials')
    // Channel linking is admin-only; an unlinked viewer gets no picker.
    expect(text).not.toContain('nuphos_link_channel')
    expect(text).toContain('nuphos_home_refresh')
  })

  test('non-admin members see linked channels but no picker', () => {
    const view = buildSlackHomeViewFromModel({
      ...baseModel,
      viewer: { name: 'Jane', email: 'jane@acme.dev', role: 'EDITOR' },
      credentials: [],
    })
    const text = viewText(view)

    expect(text).toContain('<#C1>')
    expect(text).not.toContain('nuphos_link_channel')
    expect(text).toContain('nuphos_home_refresh')
  })

  test('caps long credential lists with a +N more marker', () => {
    const view = buildSlackHomeViewFromModel({
      ...baseModel,
      viewer: { name: 'Jane', email: 'jane@acme.dev', role: null },
      credentials: [
        {
          provider: 'AWS',
          entries: Array.from({ length: 14 }, (_, i) => `arn:aws:iam::1:role/Role${String(i)}`),
        },
      ],
    })
    const text = viewText(view)

    expect(text).toContain('Role9')
    expect(text).not.toContain('Role10')
    expect(text).toContain('+4 more')
  })

  test('escapes mrkdwn-significant characters from team-supplied values', () => {
    const view = buildSlackHomeViewFromModel({
      ...baseModel,
      teamName: 'Acme <js>&co',
      viewer: { name: 'Jane', email: 'jane@acme.dev', role: null },
      credentials: [{ provider: 'Linode', entries: ['prod `rm -rf` <b>'] }],
    })
    const text = viewText(view)

    expect(text).toContain('Acme &lt;js&gt;&amp;co')
    expect(text).toContain('prod rm -rf &lt;b&gt;')
    expect(text).not.toContain('rm -rf` <b>')
  })
})

describe('buildConnectedSlackHomeView', () => {
  test('renders an unlinked member as not linked even with a stale mapping', async () => {
    teamsById = [{ id: TEAM_ID, name: 'Acme' }]
    members = [] // mapped Nuphos user no longer on the team
    channelMappings = [
      { slackWorkspaceId: 'T1', slackChannelId: 'C1', enabled: true },
      { slackWorkspaceId: 'T-other', slackChannelId: 'C9', enabled: true },
      { slackWorkspaceId: 'T1', slackChannelId: 'C2', enabled: false },
    ]
    const view = await buildConnectedSlackHomeView({
      slackWorkspaceId: 'T1',
      slackTeamName: 'Acme Slack',
      botUserId: 'B123',
      nuphosTeamId: TEAM_ID,
      nuphosUserId: 'gone-user',
    })
    const text = viewText(view)

    expect(text).toContain('Not linked')
    // Only enabled mappings of THIS workspace show up.
    expect(text).toContain('<#C1>')
    expect(text).not.toContain('<#C9>')
    expect(text).not.toContain('<#C2>')
  })
})

describe('buildDisconnectedSlackHomeView', () => {
  test('explains how to connect the workspace', () => {
    const text = viewText(buildDisconnectedSlackHomeView())

    expect(text).toContain("isn't connected to a Nuphos team yet")
    expect(text).toContain('Settings → Slack')
  })
})
