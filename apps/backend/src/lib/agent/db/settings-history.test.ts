import { beforeEach, expect, test } from 'bun:test'

import {
  recordSessionConfig,
  storeSessionConfig,
} from '@/lib/claude-code-preview/session-config-record'
import { useDb } from '@/lib/test/doubles/db'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import {
  setConversationPreviewAttachment,
  stampConversationRuntimeInstance,
} from './conversations-runtime'
import { updateConversationSettings } from './settings-history'

import type { SettingsChange } from './settings-history'
import type { SessionConfigOption } from '@/lib/claude-code-preview/session-config-options'

let memory = portabilityDb()

useDb({ db: () => memory })

const choices = (...values: string[]) =>
  values.map((value) => ({ value, name: value.toUpperCase() }))
const options = (model: string, effort: string, fast = 'off'): SessionConfigOption[] => [
  {
    id: 'model',
    name: 'Model',
    kind: 'model',
    currentValue: model,
    options: choices('sol', 'astra'),
  },
  {
    id: 'effort',
    name: 'Effort',
    kind: 'effort',
    currentValue: effort,
    options: choices('low', 'medium'),
  },
  { id: 'fast', name: 'Fast', kind: 'fast', currentValue: fast, options: choices('off', 'on') },
]
const stored = () => memory.rows('agent_conversations')[0]!
const history = () => stored().settingsHistory as SettingsChange[] | undefined

function conversation(extra: Record<string, unknown> = {}) {
  memory.rows('agent_conversations').push({
    sessionId: 'c',
    teamId: 't',
    userId: 'owner',
    runtimeId: 'mini',
    runtimeLabel: 'Mac Mini',
    agentRuntime: 'codex',
    ...extra,
  })
}
const attached = (sessionConfig?: SessionConfigOption[], runtimeDefaults = {}) => ({
  claudeCodePreview: {
    openabSessionId: 's',
    runtimeUrl: 'wss://mini/acp',
    runtimeDefaults,
    ...(sessionConfig ? { sessionConfig } : {}),
  },
})

beforeEach(() => {
  memory = portabilityDb()
})

test('the picker on a live session records each change, with names, who and the app', async () => {
  conversation(attached(options('sol', 'low')))
  await storeSessionConfig('c', 't', 's', options('astra', 'medium'), {
    actorId: 'owner',
    via: 'picker',
    client: 'desktop',
  })

  expect(history()).toEqual([
    {
      at: expect.any(Date),
      actorId: 'owner',
      via: 'picker',
      client: 'desktop',
      model: { from: { value: 'sol', name: 'SOL' }, to: { value: 'astra', name: 'ASTRA' } },
      effort: { from: { value: 'low', name: 'LOW' }, to: { value: 'medium', name: 'MEDIUM' } },
    },
  ])
})

test('the same settings again record nothing', async () => {
  conversation(attached(options('sol', 'low')))
  await storeSessionConfig('c', 't', 's', options('sol', 'low'), {
    actorId: 'owner',
    via: 'picker',
  })

  expect(history()).toBeUndefined()
  // Nor write at all: a session reports its settings with every turn (#3789).
  expect(stored().settingsRevision).toBeUndefined()
})

test('a setting the agent changed by itself after a turn is recorded as the system’s', async () => {
  conversation(attached(options('sol', 'low', 'on')))
  await recordSessionConfig(
    { getSessionConfigOptions: async () => ({ configOptions: options('sol', 'low', 'off') }) },
    'c',
    't',
    's',
  )

  expect(history()).toMatchObject([
    {
      actorId: 'system',
      via: 'runtime_reported',
      fast: { from: { value: 'on' }, to: { value: 'off' } },
    },
  ])
})

// The case that left a Bot on Low with no one having picked it.
test('a new session records the defaults the agent filled in beside the pick it was given', async () => {
  conversation({ initialSessionConfig: { model: 'sol' } })
  await setConversationPreviewAttachment('c', 't', {
    openabSessionId: 's',
    runtimeUrl: 'wss://mini/acp',
    runtimeDefaults: { model: 'sol' },
    sessionConfig: options('sol', 'low'),
  })

  expect(history()).toEqual([
    {
      at: expect.any(Date),
      actorId: 'system',
      via: 'session_start',
      effort: { to: { value: 'low', name: 'LOW' } },
      fast: { to: { value: 'off', name: 'OFF' } },
    },
  ])
})

test('a new session on a model other than the one asked for records the switch', async () => {
  conversation({ initialSessionConfig: { model: 'retired', effort: 'low' } })
  await setConversationPreviewAttachment('c', 't', {
    openabSessionId: 's',
    runtimeUrl: 'wss://mini/acp',
    runtimeDefaults: { model: 'retired', effort: 'low' },
    sessionConfig: options('sol', 'low').slice(0, 2),
  })

  expect(history()).toMatchObject([
    { via: 'session_start', model: { from: { value: 'retired' }, to: { value: 'sol' } } },
  ])
  expect(history()?.[0]).not.toHaveProperty('effort')
})

test('the first agent a conversation is placed on is recorded, and only once', async () => {
  memory.rows('agent_conversations').push({ sessionId: 'c', teamId: 't', userId: 'owner' })
  await stampConversationRuntimeInstance('c', 'mini', 'Mac Mini')
  await stampConversationRuntimeInstance('c', 'box', 'Box')

  expect(stored().runtimeId).toBe('mini')
  expect(history()).toMatchObject([
    { actorId: 'system', via: 'placement', runtime: { to: { id: 'mini', label: 'Mac Mini' } } },
  ])
  expect(history()).toHaveLength(1)
})

test('no write matching leaves the conversation and its history alone', async () => {
  conversation(attached(options('sol', 'low')))
  await storeSessionConfig('c', 't', 'another-session', options('astra', 'low'), {
    actorId: 'owner',
    via: 'picker',
  })

  expect(stored().claudeCodePreview).toMatchObject({ sessionConfig: options('sol', 'low') })
  expect(history()).toBeUndefined()
})

test('a write that raced another reads again, so each record names what it replaced', async () => {
  conversation({ initialSessionConfig: { model: 'sol' } })
  const collection = memory.collection('agent_conversations')
  const findOne = collection.findOne
  let raced = false

  // Another replica changes the model between this write's read and its update.
  memory.collection = () => ({
    ...collection,
    findOne: async (query: Record<string, unknown>) => {
      const doc = structuredClone(await findOne(query))

      if (!raced) {
        raced = true
        await updateConversationSettings(
          { sessionId: 'c' },
          { $set: { initialSessionConfig: { model: 'astra' } } },
          { actorId: 'teammate', via: 'picker' },
        )
      }

      return doc
    },
  })
  await updateConversationSettings(
    { sessionId: 'c' },
    { $set: { initialSessionConfig: { model: 'nova' } } },
    { actorId: 'owner', via: 'picker' },
  )

  expect(stored().initialSessionConfig).toEqual({ model: 'nova' })
  expect(
    history()?.map(({ actorId, model }) => [actorId, model?.from?.value, model?.to?.value]),
  ).toEqual([
    ['teammate', 'sol', 'astra'],
    ['owner', 'astra', 'nova'],
  ])
})

test('the history is never cut, however long it grows', async () => {
  conversation({ initialSessionConfig: { model: 'm0' } })
  for (let i = 1; i <= 250; i++)
    await updateConversationSettings(
      { sessionId: 'c' },
      { $set: { initialSessionConfig: { model: `m${String(i)}` } } },
      { actorId: 'owner', via: 'picker' },
    )

  expect(history()).toHaveLength(250)
  expect(history()?.[0]?.model?.from?.value).toBe('m0')
})
