import { describe, expect, test } from 'bun:test'

import { useLarkAgentOutbound } from '@/lib/test/doubles/lark-agent-outbound'
import { useSlackAgentOutbound } from '@/lib/test/doubles/slack-agent-outbound'
import { useSlackInstallations } from '@/lib/test/doubles/slack-installations'

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

  test('a Slack-bound conversation on an installed workspace adds slack_react', async () => {
    const tools = await previewChannelToolSet({
      ...base,
      slackThread: { teamId: 'T-installed', channelId: 'C1', threadTs: '100.1' },
    })

    expect(Object.keys(tools)).toContain('slack_react')
  })

  test('an unknown workspace yields no reply-context tools rather than failing', async () => {
    const tools = await previewChannelToolSet({
      ...base,
      slackThread: { teamId: 'T-unknown', channelId: 'C1', threadTs: '100.1' },
    })

    expect(Object.keys(tools)).not.toContain('slack_react')
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
