import { expect, test } from 'bun:test'

import { real, useDb } from '@/lib/test/doubles/db'

import { sessionResources, unlinkSessionThread } from './session-thread-resources'

import type { AgentConversation } from './db'

const createdAt = new Date('2026-10-11T00:00:00Z')
const rows: Record<string, unknown[]> = {
  slack_agent_threads: [
    {
      sessionId: 's1',
      slackWorkspaceId: 'T1',
      slackChannelId: 'C1',
      slackThreadTs: '1.2',
      recentMessages: [{ ts: '1.2', authorName: 'a', text: 'Deploy  failed\non prod' }],
      createdAt,
    },
  ],
  discord_agent_threads: [{ sessionId: 's1', guildId: 'G1', threadChannelId: 'D1', createdAt }],
}
const deleted: unknown[] = []

useDb({
  db: () =>
    ({
      collection: (name: string) => ({
        find: () => ({ toArray: () => Promise.resolve(rows[name] ?? []) }),
        deleteOne: (filter: unknown) => Promise.resolve(void deleted.push([name, filter])),
      }),
    }) as unknown as ReturnType<typeof real.db>,
})

test('session resources lead with the bound Slack and Discord threads', async () => {
  const resources = await sessionResources({
    sessionId: 's1',
    firstMessage: 'Why is checkout slow?',
    linkedResources: [
      { id: 'pr', provider: 'github', url: 'https://github.com/o/r/pull/1', title: 'PR' },
    ],
  } as unknown as AgentConversation)

  expect(resources.map((resource) => [resource.provider, resource.url, resource.title])).toEqual([
    ['slack', 'https://app.slack.com/client/T1/C1/thread/C1-1.2', 'Deploy failed on prod'],
    ['discord', 'https://discord.com/channels/G1/D1', 'Why is checkout slow?'],
    ['github', 'https://github.com/o/r/pull/1', 'PR'],
  ])
})

test('unlinking a thread tag deletes its routing row and nothing else', async () => {
  await unlinkSessionThread('s1', 'slack:C1:1.2')
  await unlinkSessionThread('s1', 'discord:D1')
  await unlinkSessionThread('s1', '5f1c0f5e-1b5d-4c55-9a4e-2b1f3c4d5e6f')

  expect(deleted).toEqual([
    ['slack_agent_threads', { sessionId: 's1', slackChannelId: 'C1', slackThreadTs: '1.2' }],
    ['discord_agent_threads', { sessionId: 's1', threadChannelId: 'D1' }],
  ])
})
