import { expect, test } from 'bun:test'

import { real, useDb } from '@/lib/test/doubles/db'

import { sessionResources } from './session-thread-resources'

import type { AgentConversation } from './db'

const createdAt = new Date('2026-10-11T00:00:00Z')
const rows: Record<string, unknown[]> = {
  slack_agent_threads: [
    {
      sessionId: 's1',
      slackWorkspaceId: 'T1',
      slackChannelId: 'C1',
      slackThreadTs: '1.2',
      createdAt,
    },
  ],
  discord_agent_threads: [{ sessionId: 's1', guildId: 'G1', threadChannelId: 'D1', createdAt }],
}

useDb({
  db: () =>
    ({
      collection: (name: string) => ({
        find: () => ({ toArray: () => Promise.resolve(rows[name] ?? []) }),
      }),
    }) as unknown as ReturnType<typeof real.db>,
})

test('session resources append the bound Slack and Discord threads', async () => {
  const resources = await sessionResources({
    sessionId: 's1',
    linkedResources: [{ id: 'pr', provider: 'github' }],
  } as unknown as AgentConversation)

  expect(resources.map((resource) => [resource.provider, resource.url])).toEqual([
    ['github', undefined],
    ['slack', 'https://app.slack.com/client/T1/C1/thread/C1-1.2'],
    ['discord', 'https://discord.com/channels/G1/D1'],
  ])
})
