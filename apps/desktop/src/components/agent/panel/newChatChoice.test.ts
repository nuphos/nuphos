import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  chooseAgent,
  confirmedChoice,
  newChatChoiceKey,
  parseNewChatChoice,
  readNewChatChoice,
  saveNewChatChoice,
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

test('a model switched inside a chat is what the next new chat (Cmd+N) starts with', () => {
  const stored = new Map<string, string>()
  const storage = () => ({
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
  })
  const key = newChatChoiceKey('team-switch')
  const option = (kind: 'model' | 'effort', currentValue: string) => ({
    id: kind,
    name: kind,
    kind,
    currentValue,
    options: [],
  })

  saveNewChatChoice(key, { runtimeId: 'codex', pick: { model: 'sol', effort: 'low' } }, storage)
  saveNewChatChoice(
    key,
    confirmedChoice('codex', [option('model', 'astra'), option('effort', 'high')]),
    storage,
  )

  assert.deepEqual(readNewChatChoice(key, storage), {
    runtimeId: 'codex',
    pick: { model: 'astra', effort: 'high' },
  })
  assert.deepEqual(parseNewChatChoice(stored.get(key) ?? null), readNewChatChoice(key, storage))
})
