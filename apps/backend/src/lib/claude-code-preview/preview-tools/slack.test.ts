import { describe, expect, test } from 'bun:test'

import { useLarkAgentOutbound } from '@/lib/test/doubles/lark-agent-outbound'
import { useSlackAgentOutbound } from '@/lib/test/doubles/slack-agent-outbound'
import { useSlackApi } from '@/lib/test/doubles/slack-api'
import { useSlackInstallations } from '@/lib/test/doubles/slack-installations'

import type { AiSdkToolLike } from './ai-sdk-adapter'
import type { PreviewToolContext } from '../preview-tool-context'

useSlackInstallations({
  resolveInstalledWorkspaceBot: (slackTeamId: string) =>
    Promise.resolve(
      slackTeamId === 'T-installed'
        ? { botToken: 'xoxb-test', workspaceName: 'Acme', nuphosTeamId: 'team-1' }
        : null,
    ),
})
useSlackAgentOutbound({ createSlackOutboundContext: () => Promise.resolve(null) })
useLarkAgentOutbound({ createLarkOutboundContext: () => Promise.resolve(null) })

const installSlackApi = useSlackApi({})

const { previewChannelToolSet, slackPreviewToolModule } = await import('./slack')

const base: PreviewToolContext = {
  userId: 'user-1',
  teamId: 'team-1',
  sessionId: 'conv-1',
  locale: 'en',
}

describe('slack preview tool module', () => {
  test('a conversation without a Slack thread gets only the outbound notification tools', async () => {
    const names = Object.keys(await previewChannelToolSet(base)).sort((a, b) => a.localeCompare(b))

    expect(names).toEqual([
      'lark_list_destinations',
      'lark_post',
      'slack_list_destinations',
      'slack_post',
    ])
  })

  test('a Slack-bound conversation adds reactions and parent channel history', async () => {
    const tools = await previewChannelToolSet({
      ...base,
      slackThread: { teamId: 'T-installed', channelId: 'C1', threadTs: '100.1' },
    })

    expect(Object.keys(tools)).toContain('slack_react')
    expect(Object.keys(tools)).toContain('slack_channel_history')
  })

  test('an unknown workspace yields no reply-context tools rather than failing', async () => {
    const tools = await previewChannelToolSet({
      ...base,
      slackThread: { teamId: 'T-unknown', channelId: 'C1', threadTs: '100.1' },
    })

    expect(Object.keys(tools)).not.toContain('slack_react')
    expect(Object.keys(tools)).not.toContain('slack_channel_history')
  })

  test('history reads the bound channel and preserves pagination and time bounds', async () => {
    const requests: unknown[] = []
    const messages = [{ ts: '99.1', user: 'U1', text: 'Earlier channel discussion' }]

    installSlackApi({
      fetchSlackChannelHistory: (request) => {
        requests.push(request)

        return Promise.resolve({ messages, hasMore: true, nextCursor: 'next-page' })
      },
    })
    const tools = await previewChannelToolSet({
      ...base,
      slackThread: { teamId: 'T-installed', channelId: 'C1', threadTs: '100.1' },
    })
    const tool = tools.slack_channel_history as AiSdkToolLike
    const result = await tool.execute!(
      { label: 'Read channel history', limit: 15, cursor: 'page', oldest: '90.1', latest: '100.1' },
      {},
    )

    expect(requests).toEqual([
      {
        token: 'xoxb-test',
        channel: 'C1',
        limit: 15,
        cursor: 'page',
        oldest: '90.1',
        latest: '100.1',
      },
    ])
    expect(result).toEqual({
      ok: true,
      channel: 'C1',
      messages,
      hasMore: true,
      nextCursor: 'next-page',
    })
  })

  test('history reports Slack failures without pretending the channel is empty', async () => {
    installSlackApi({
      fetchSlackChannelHistory: () =>
        Promise.reject(new Error('Slack conversations.history failed: missing_scope')),
    })
    const tools = await previewChannelToolSet({
      ...base,
      slackThread: { teamId: 'T-installed', channelId: 'C1', threadTs: '100.1' },
    })
    const tool = tools.slack_channel_history as AiSdkToolLike

    expect(await tool.execute!({ label: 'Read channel history' }, {})).toEqual({
      ok: false,
      channel: 'C1',
      error: 'Slack conversations.history failed: missing_scope',
    })
  })

  test('every advertised tool carries the classic user-facing label input', async () => {
    const module = await slackPreviewToolModule({
      ...base,
      slackThread: { teamId: 'T-installed', channelId: 'C1', threadTs: '100.1' },
    })

    expect(module.definitions.length).toBeGreaterThan(0)
    for (const definition of module.definitions) {
      const schema = (definition as { inputSchema: { properties: Record<string, unknown> } })
        .inputSchema

      expect(schema.properties.label).toBeDefined()
    }
  })
})
