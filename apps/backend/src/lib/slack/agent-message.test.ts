import { beforeEach, describe, expect, test } from 'bun:test'

import { agentConversations } from '@/lib/agent/db'
import { useDb } from '@/lib/test/doubles/db'
import { useSlackApi } from '@/lib/test/doubles/slack-api'
import { useSlackInstallations } from '@/lib/test/doubles/slack-installations'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import type { AgentConversation } from '@/lib/agent/db'
import type * as dbActual from '@/lib/db'

let memory = portabilityDb()
const posted: Record<string, unknown>[] = []

useDb({ db: (() => memory) as unknown as typeof dbActual.db })
useSlackInstallations({
  resolveSlackBotForWorkspace: () =>
    Promise.resolve({ botToken: 'xoxb-1', binding: { scope: 'chat:write' } } as never),
})
useSlackApi({
  postSlackMessage: async (args: Record<string, unknown>) => {
    posted.push(args)

    return { ok: true, ts: '1.1', channel: 'C1' }
  },
})

const { postAgentSlackMessage } = await import('@/lib/slack/agent-message')

const seed = (sessionId: string, extra: Partial<AgentConversation>) =>
  agentConversations().insertOne({
    sessionId,
    userId: 'owner',
    title: 'Chat',
    firstMessage: '',
    messageCount: 0,
    createdAt: new Date(),
    lastActiveAt: new Date(),
    ...extra,
  } as AgentConversation)
const from = (sessionId: string) => ({ sessionId, slackWorkspaceId: 'T1' })
const post = (sessionId: string, text = 'Done.') =>
  postAgentSlackMessage({ token: 'xoxb-1', channel: 'C1', text, from: from(sessionId) })

beforeEach(async () => {
  memory = portabilityDb()
  posted.length = 0
  await seed('bot', { title: 'Deploy Bot', avatar: 'robot' })
  await seed('task', { title: 'Check the rollout', parentSessionId: 'bot' })
  await seed('chat', {})
})

describe('postAgentSlackMessage', () => {
  test('normalizes the agent CommonMark into Slack mrkdwn before posting', async () => {
    await post(
      'chat',
      '- **重點**：見 [sample-project](https://example.com/projects/sample-project)',
    )

    expect(posted).toHaveLength(1)
    expect(posted[0]!.text).toBe(
      '• *重點*：見 <https://example.com/projects/sample-project|sample-project>',
    )
  })

  test('passes the routing fields straight through', async () => {
    await postAgentSlackMessage({
      token: 'xoxb-1',
      channel: 'C9',
      threadTs: '7.7',
      text: 'hi',
      from: from('chat'),
    })

    expect(posted[0]).toMatchObject({ token: 'xoxb-1', channel: 'C9', threadTs: '7.7', text: 'hi' })
  })

  test('keeps a real mention token intact so the person is still notified', async () => {
    await post('chat', '可以，<@U123ABC>。')

    expect(posted[0]!.text).toBe('可以，<@U123ABC>。')
  })

  test('a Bot and a Task under it both post under the Bot’s name; other chats do not', async () => {
    for (const sessionId of ['bot', 'task', 'chat']) await post(sessionId)

    expect(posted.map((one) => one.text)).toEqual([
      '*Deploy Bot*\nDone.',
      '*Deploy Bot*\nDone.',
      'Done.',
    ])
  })

  test('a Task under another owner’s Bot is not named for it', async () => {
    await seed('stray', { userId: 'someone-else', parentSessionId: 'bot' })
    await post('stray')

    expect(posted[0]!.text).toBe('Done.')
  })
})
