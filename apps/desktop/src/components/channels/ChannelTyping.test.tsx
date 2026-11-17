import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { ChannelAgent } from '../../api'
import type { RuntimeExecution } from '../../lib/runtimeExecution'

const states = new Map<string, RuntimeExecution>()

mock.module('../../lib/agentRuntimeStates', () => ({ useAgentRuntimeStates: () => states }))
mock.module('../agent/AgentAvatar', () => ({ AgentAvatar: () => null }))
const { Typing } = await import('./ChannelTyping')
const agents = [{ sessionId: 'bot', title: 'Atlas' }] as ChannelAgent[]
const render = (botId?: string) =>
  renderToStaticMarkup(createElement(Typing, { agents, channelId: 'chat', botId }))

test('a private Bot working on an external event still shows its in-chat indicator', () => {
  states.set('bot', { state: 'active', phase: 'running', channelIds: [] })
  assert.ok(render('bot').includes('data-open="true"'))
})

test('group chats do not show an unrelated active agent, but do show channel work', () => {
  states.set('bot', { state: 'active', channelIds: ['elsewhere'] })
  assert.ok(!render().includes('data-open="true"'))
  states.set('bot', { state: 'active', channelIds: ['chat'] })
  assert.ok(render().includes('data-open="true"'))
})

test('idle, disconnected and reconnecting Bots do not look like they are composing', () => {
  for (const snapshot of [
    { state: 'idle' },
    { state: 'disconnected' },
    { state: 'active', phase: 'resume_disconnected' },
  ] as RuntimeExecution[]) {
    states.set('bot', snapshot)
    assert.ok(!render('bot').includes('data-open="true"'))
  }
})
