import { expect, test } from 'bun:test'

import { parseCreatedTriggers } from './message-created-triggers'
import { parseMessageMetadata } from './message-metadata'

const trigger = (n: number) => ({ id: `t${String(n)}`, name: `Routine ${String(n)}` })

test('createdTriggers that are not an array are dropped', () => {
  for (const value of [undefined, null, 'trigger', 42, { id: 't1', name: 'Daily' }])
    expect(parseCreatedTriggers(value)).toBeUndefined()
})

test('entries without a non-empty string id and name are dropped', () => {
  expect(
    parseCreatedTriggers([
      null,
      'Daily',
      { id: '', name: 'Empty id' },
      { id: 't1', name: '' },
      { id: 7, name: 'Number id' },
      { id: 't2', name: ['Daily'] },
      { name: 'No id' },
      { ...trigger(3), extra: 'ignored' },
    ]),
  ).toEqual([trigger(3)])
  expect(parseCreatedTriggers([{ id: '', name: '' }])).toBeUndefined()
  expect(parseCreatedTriggers([])).toBeUndefined()
})

test('at most 64 entries are kept', () => {
  const parsed = parseCreatedTriggers(Array.from({ length: 70 }, (_, n) => trigger(n)))

  expect(parsed).toHaveLength(64)
  expect(parsed?.at(-1)).toEqual(trigger(63))
})

test('createdTriggers is read only from a post a Bot wrote itself', () => {
  const base = {
    version: 1,
    sender: { type: 'agent', id: 'bot', displayName: 'Research' },
    sentAt: '2026-11-24T00:00:00.000Z',
    createdTriggers: [trigger(1)],
  }

  expect(
    parseMessageMetadata({ ...base, source: 'agent.thread', sourceSessionId: 'bot' })
      ?.createdTriggers,
  ).toEqual([trigger(1)])
  for (const metadata of [
    { ...base, sender: { type: 'user', id: 'alice', displayName: 'Alice' }, source: 'nuphos' },
    {
      ...base,
      sender: { type: 'system', id: 'github', displayName: 'GitHub' },
      source: 'agent.resource',
    },
    {
      ...base,
      sender: { ...base.sender, onBehalfOf: { id: 'alice', displayName: 'Alice' } },
      source: 'nuphos',
    },
  ]) {
    const parsed = parseMessageMetadata(metadata)

    expect(parsed).toBeDefined()
    expect(parsed).not.toHaveProperty('createdTriggers')
  }
})
