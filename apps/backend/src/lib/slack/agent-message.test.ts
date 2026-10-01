import { beforeEach, describe, expect, test } from 'bun:test'

import { useSlackApi } from '@/lib/test/doubles/slack-api'

const posted: Record<string, unknown>[] = []

useSlackApi({
  postSlackMessage: async (args: Record<string, unknown>) => {
    posted.push(args)

    return { ok: true, ts: '1.1', channel: 'C1' }
  },
})

const { postAgentSlackMessage } = await import('@/lib/slack/agent-message')

beforeEach(() => {
  posted.length = 0
})

describe('postAgentSlackMessage', () => {
  test('normalizes the agent CommonMark into Slack mrkdwn before posting', async () => {
    await postAgentSlackMessage({
      token: 'xoxb-1',
      channel: 'C1',
      threadTs: '100.1',
      text: '- **重點**：見 [sample-project](https://example.com/projects/sample-project)',
    })

    expect(posted).toHaveLength(1)
    expect(posted[0]!.text).toBe(
      '• *重點*：見 <https://example.com/projects/sample-project|sample-project>',
    )
  })

  test('passes the routing fields straight through', async () => {
    await postAgentSlackMessage({ token: 'xoxb-1', channel: 'C9', threadTs: '7.7', text: 'hi' })

    expect(posted[0]).toMatchObject({ token: 'xoxb-1', channel: 'C9', threadTs: '7.7', text: 'hi' })
  })

  test('keeps a real mention token intact so the person is still notified', async () => {
    await postAgentSlackMessage({ token: 'xoxb-1', channel: 'C1', text: '可以，<@U123ABC>。' })

    expect(posted[0]!.text).toBe('可以，<@U123ABC>。')
  })
})
