import { expect, test } from 'bun:test'

import { agentConversations } from '@/lib/agent/db/shared'
import { useDb } from '@/lib/test/doubles/db'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import { OpenAbRpcError } from './openab-acp-errors'
import { sessionConfigView } from './session-config'
import { recordSessionConfig, settledTurn } from './session-config-record'
import { storedPick } from './session-config-options'

const TEAM = '64b000000000000000000001'
const memory = portabilityDb()

useDb({ db: () => memory })

const choices = (...values: string[]) => values.map((value) => ({ value, name: value }))
// What Claude Code reports after a turn on an account without extra usage.
const afterReply = [
  {
    id: 'model',
    name: 'Model',
    category: 'model',
    currentValue: 'opus',
    options: choices('opus', 'haiku'),
  },
  {
    id: 'effort',
    name: 'Effort',
    category: 'thought_level',
    currentValue: 'high',
    options: choices('default', 'low', 'high'),
  },
  {
    id: 'fast',
    name: 'Fast mode',
    currentValue: 'off',
    description: 'Faster responses — requires extra usage to be enabled for this account',
    options: choices('off', 'on'),
  },
]
const catalog = async () => ({
  models: [
    { id: 'opus', name: 'Opus' },
    { id: 'haiku', name: 'Haiku' },
  ],
  controls: {
    modelId: 'opus',
    effort: choices('default', 'low', 'high'),
    fast: choices('off', 'on'),
  },
})

async function conversation(sessionConfig?: unknown[]) {
  await agentConversations().deleteMany({})
  await agentConversations().insertOne({
    sessionId: 'chat',
    userId: 'owner',
    teamId: TEAM,
    title: 'Chat',
    firstMessage: '',
    messageCount: 1,
    createdAt: new Date(),
    lastActiveAt: new Date(),
    claudeCodePreview: {
      openabSessionId: 'live',
      runtimeUrl: 'ws://runtime',
      runtimeDefaults: {},
      ...(sessionConfig ? { sessionConfig } : {}),
    },
  } as never)
}
const chip = async () => {
  const stored = await agentConversations().findOne({ sessionId: 'chat' })

  return (await sessionConfigView(storedPick(stored?.claudeCodePreview), catalog)).options.map(
    ({ kind, currentValue }) => [kind, currentValue],
  )
}

test('after a reply the chip shows the settings the session runs, including ones the runtime changed', async () => {
  // Fast mode was picked on; Claude Code then turned it off during the reply.
  await conversation([{ ...afterReply[2], kind: 'fast', currentValue: 'on' }])
  expect(await chip()).toContainEqual(['fast', 'on'])

  await recordSessionConfig(
    { getSessionConfigOptions: async () => ({ configOptions: afterReply }) },
    'chat',
    TEAM,
    'live',
  )

  expect(await chip()).toEqual([
    ['model', 'opus'],
    ['effort', 'high'],
    ['fast', 'off'],
  ])
})

test('a chat started on the agent defaults gets its effort and fast controls after the first reply', async () => {
  await conversation()
  // Nothing was picked, so nothing is confirmed: no effort slider, no fast toggle.
  expect((await chip()).map(([kind]) => kind)).toEqual(['model'])

  await recordSessionConfig(
    { getSessionConfigOptions: async () => ({ configOptions: afterReply }) },
    'chat',
    TEAM,
    'live',
  )

  expect((await chip()).map(([kind]) => kind)).toEqual(['model', 'effort', 'fast'])

  // Claude Code reports its default model as "default"; the chip names the model it stands for.
  const onDefaults = afterReply.map((option) =>
    option.id === 'model'
      ? {
          ...option,
          currentValue: 'default',
          options: [{ value: 'default', name: 'Default', description: 'opus' }, ...option.options],
        }
      : { ...option, currentValue: option.id === 'effort' ? 'default' : option.currentValue },
  )

  await recordSessionConfig(
    { getSessionConfigOptions: async () => ({ configOptions: onDefaults }) },
    'chat',
    TEAM,
    'live',
  )

  expect(await chip()).toEqual([
    ['model', 'opus'],
    ['effort', 'default'],
    ['fast', 'off'],
  ])
})

test('a busy or replaced session leaves the stored settings alone', async () => {
  await conversation([{ ...afterReply[1], kind: 'effort', currentValue: 'low' }])
  const busy = {
    getSessionConfigOptions: async () => {
      throw new OpenAbRpcError('Session is responding', -32005)
    },
  }

  await recordSessionConfig(busy, 'chat', TEAM, 'live')
  await recordSessionConfig(
    { getSessionConfigOptions: async () => ({ configOptions: afterReply }) },
    'chat',
    TEAM,
    'an-older-session',
  )

  expect(await chip()).toContainEqual(['effort', 'low'])
  expect(await chip()).not.toContainEqual(['fast', 'off'])
})

test('a finished Claude Code turn stores its settings before it settles', async () => {
  await conversation([{ ...afterReply[2], kind: 'fast', currentValue: 'on' }])
  const session = {
    conversationId: 'chat',
    teamId: TEAM,
    openabSessionId: 'live',
    endpoint: { url: 'ws://runtime', provider: 'claude-code' },
  } as unknown as Parameters<typeof settledTurn>[1]
  const stop = await settledTurn(
    { getSessionConfigOptions: async () => ({ configOptions: afterReply }) },
    session,
    { stopReason: 'end_turn' },
    'OK',
  )

  expect(stop).toBe('end_turn')
  expect(await chip()).toContainEqual(['fast', 'off'])
})
