import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  chooseAgent,
  newChatChoiceKey,
  parseNewChatChoice,
  readNewChatChoice,
  saveNewChatChoice,
  sentChatChoice,
} from './newChatChoice.ts'

test('the model and effort picked for a new chat are saved with its agent', () => {
  const saved = JSON.stringify({ runtimeId: 'claude', pick: { model: 'opus', effort: 'high' } })

  assert.deepEqual(parseNewChatChoice(saved), {
    runtimeId: 'claude',
    pick: { model: 'opus', effort: 'high' },
  })
})

test('an agent id saved by an earlier build still selects that agent', () => {
  assert.deepEqual(parseNewChatChoice('dd0af1d5-33fc-43a0-a9cf-5d29dfc6545f'), {
    runtimeId: 'dd0af1d5-33fc-43a0-a9cf-5d29dfc6545f',
  })
  assert.equal(parseNewChatChoice(null), undefined)
  assert.equal(parseNewChatChoice('{not json'), undefined)
  assert.equal(parseNewChatChoice('{"pick":{}}'), undefined)
})

test('re-choosing the same agent keeps its picks; another agent starts from its defaults', () => {
  const choice = { runtimeId: 'claude', pick: { model: 'opus', effort: 'high' } }

  assert.equal(chooseAgent(choice, 'claude'), choice)
  assert.deepEqual(chooseAgent(choice, 'codex'), { runtimeId: 'codex' })
  assert.deepEqual(chooseAgent(undefined, 'codex'), { runtimeId: 'codex' })
})

test('a choice stands for this run even when storage cannot save or read it', () => {
  const broken = () => ({
    getItem: () => {
      throw new Error('SecurityError')
    },
    setItem: () => {
      throw new Error('QuotaExceededError')
    },
  })
  const key = 'test.broken-storage'

  assert.equal(readNewChatChoice(key, broken), undefined)
  saveNewChatChoice(key, { runtimeId: 'claude', pick: { effort: 'high' } }, broken)
  assert.deepEqual(readNewChatChoice(key, broken), {
    runtimeId: 'claude',
    pick: { effort: 'high' },
  })
})

test('a saved choice is read once and stays the same object until changed', () => {
  const stored = new Map([['test.saved', '{"runtimeId":"codex","pick":{"model":"sol"}}']])
  let reads = 0
  const storage = () => ({
    getItem: (key: string) => {
      reads++

      return stored.get(key) ?? null
    },
    setItem: (key: string, value: string) => void stored.set(key, value),
  })
  const first = readNewChatChoice('test.saved', storage)

  assert.equal(readNewChatChoice('test.saved', storage), first)
  assert.equal(reads, 1)
  saveNewChatChoice('test.saved', { runtimeId: 'claude' }, storage)
  assert.deepEqual(readNewChatChoice('test.saved', storage), { runtimeId: 'claude' })
  assert.equal(stored.get('test.saved'), '{"runtimeId":"claude"}')
})

test('sending in a chat makes its agent and settings what the next new chat (Cmd+N) starts with', () => {
  const stored = new Map<string, string>()
  const storage = () => ({
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
  })
  const key = newChatChoiceKey('team-sent')
  const option = (kind: 'model' | 'effort', currentValue: string) => ({
    // Codex names its effort option reasoning_effort; the choice is kept by kind.
    id: kind === 'effort' ? 'reasoning_effort' : kind,
    name: kind,
    kind,
    currentValue,
    options: [],
  })

  // The last choice was an agent switch on the new-chat page, with no model.
  saveNewChatChoice(key, { runtimeId: 'codex' }, storage)
  const sent = sentChatChoice('claude', {
    status: 'ready',
    options: [option('model', 'opus'), option('effort', 'high')],
  })

  assert.ok(sent)
  saveNewChatChoice(key, sent, storage)
  assert.deepEqual(readNewChatChoice(key, storage), {
    runtimeId: 'claude',
    pick: { model: 'opus', effort: 'high' },
  })
  assert.deepEqual(parseNewChatChoice(stored.get(key) ?? null), readNewChatChoice(key, storage))
})

test('a chat whose settings are unknown leaves the next new chat as it was', () => {
  assert.equal(sentChatChoice(undefined, { status: 'ready', options: [] }), undefined)
  assert.equal(sentChatChoice('claude', undefined), undefined)
  assert.equal(sentChatChoice('claude', { status: 'offline', options: [] }), undefined)
  // An agent without model controls is still the agent the next chat starts on.
  assert.deepEqual(sentChatChoice('custom', { status: 'unsupported', options: [] }), {
    runtimeId: 'custom',
    pick: {},
  })
})
