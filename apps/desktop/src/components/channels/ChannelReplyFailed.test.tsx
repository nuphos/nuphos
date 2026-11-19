import assert from 'node:assert/strict'
import { mock, test } from 'bun:test'

import { renderToStaticMarkup } from 'react-dom/server'

import type { AgentTimelineEvent } from '../../api'

// The sign-in fixes read the workspace's agents; this line's own fixes are under test.
mock.module('./ChannelReplyFix', () => ({ ChannelReplyFix: () => null }))

const { ChannelReplyFailed } = await import('./ChannelReplyFailed')

const portal = 'https://portal.anthropic.com/verify?org=00000000-0000-4000-8000-000000000000'
const event = {
  kind: 'agent_reply_failed',
  at: '2026-11-19T15:12:26Z',
  text: 'Ada couldn’t reply: its Claude Code account must be verified with Anthropic.',
  agentId: 'bot-ada',
  cause: 'usage_limit',
  verifyUrl: portal,
} as AgentTimelineEvent

const render = (owned: string[]) =>
  renderToStaticMarkup(
    <ChannelReplyFailed
      event={event}
      channelId="channel"
      teamId="team"
      actionable
      ownedAgents={new Set(owned)}
      onOpenSession={() => undefined}
    />,
  )

test('a Claude account held for verification offers its owner the portal, then the other fixes', () => {
  const html = render(['bot-ada'])
  const order = ['Verify with Anthropic', 'Switch runtime', 'Retry'].map((label) =>
    html.indexOf(label),
  )

  assert.ok(html.includes(`href="${portal}"`), html)
  assert.ok(html.includes('target="_blank"'), html)
  assert.ok(
    order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1]!)),
    html,
  )
})

test('someone who does not own the agent gets the line and Retry only', () => {
  const html = render([])

  assert.ok(!html.includes('Verify with Anthropic'), html)
  assert.ok(!html.includes('Switch runtime'), html)
  assert.ok(html.includes('Retry'), html)
})
