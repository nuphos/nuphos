import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { BotPresence, ChannelAgent } from '../../api'
import type { RuntimeExecution } from '../../lib/runtimeExecution'

const states = new Map<string, RuntimeExecution>()

mock.module('../../lib/agentRuntimeStates', () => ({ useAgentRuntimeStates: () => states }))
mock.module('../agent/AgentAvatar', () => ({ AgentAvatar: () => null }))
const { Typing } = await import('./ChannelTyping')
const render = (presence: BotPresence, waiting = true) =>
  renderToStaticMarkup(
    createElement(Typing, {
      agents: [{ sessionId: 'scribe', title: 'Scribe', presence }] as ChannelAgent[],
      channelId: 'chat',
      waiting: new Set(waiting ? ['scribe'] : []),
    }),
  )

test('a waiting post to a Bot whose computer is offline says it will reply once it is back', () => {
  assert.ok(
    render({ state: 'offline', reason: 'computer_offline' }).includes(
      'Scribe’s computer is offline. It will reply when the computer is back.',
    ),
  )
})

test('no line without a waiting post, for an online or busy Bot, or where a person must act', () => {
  for (const html of [
    render({ state: 'offline', reason: 'computer_offline' }, false),
    render({ state: 'online' }),
    // A person's post joins a busy Bot's turn, which shows its dots instead.
    render({ state: 'busy' }),
    render({ state: 'offline', reason: 'sign_in_required' }),
    render({ state: 'offline', reason: 'usage_limit' }),
  ])
    assert.ok(!html.includes('It will reply'))
})

test('the work dots win once the Bot works in this chat', () => {
  states.set('scribe', { state: 'active', channelIds: ['chat'] })
  const html = render({ state: 'busy' })

  states.delete('scribe')
  assert.ok(html.includes('data-open="true"'))
  assert.ok(!html.includes('It will reply'))
})
