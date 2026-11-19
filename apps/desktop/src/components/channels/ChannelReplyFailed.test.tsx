import assert from 'node:assert/strict'
import { test } from 'node:test'

import { renderToStaticMarkup } from 'react-dom/server'

import { ChannelReplyFailed } from './ChannelReplyFailed'

import type { AgentTimelineEvent } from '../../api'

const portal = 'https://portal.anthropic.com/verify?org=00000000-0000-4000-8000-000000000000'

test('a Claude account held for verification links where its holder verifies it', () => {
  const event = {
    kind: 'agent_reply_failed',
    at: '2026-11-19T15:12:26Z',
    text: `Ada couldn’t reply: its Claude Code account must be verified with Anthropic (Your account can't receive replies from Claude right now. You can find the next step in the Anthropic Verification Portal: ${portal}).`,
    agentId: 'bot-ada',
    cause: 'usage_limit',
  } as AgentTimelineEvent

  const html = renderToStaticMarkup(
    <ChannelReplyFailed
      event={event}
      channelId="channel"
      teamId="team"
      actionable={false}
      ownedAgents={new Set()}
      onOpenSession={() => undefined}
    />,
  )

  assert.match(html, /must be verified with Anthropic/u)
  assert.ok(html.includes(`<a href="${portal.replace('&', '&amp;')}" target="_blank"`), html)
  assert.ok(html.includes(`>${portal}</a>).`), html)
})
