import { beforeEach, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { isFirstTurn, shouldInitializePermissionMode } from './chat-permission-mode'

import type { AgentChatBody } from './types'

const docs = new Map<string, Record<string, unknown>>()

useDb({
  db: () => ({
    collection: () => ({
      updateOne(
        filter: { conversationId: string; userId: string },
        update: { $setOnInsert?: Record<string, unknown>; $set?: Record<string, unknown> },
        options: { upsert?: boolean },
      ) {
        const key = `${filter.userId}:${filter.conversationId}`
        let doc = docs.get(key)

        if (!doc && options.upsert) {
          doc = { ...filter, ...update.$setOnInsert }
          docs.set(key, doc)
        }
        if (doc) Object.assign(doc, update.$set)

        return Promise.resolve()
      },
      findOne(filter: { conversationId: string; userId: string }) {
        return Promise.resolve(docs.get(`${filter.userId}:${filter.conversationId}`) ?? null)
      },
    }),
  }),
})

const { initializeSessionBypass, setSessionBypass, getSessionBypass } =
  await import('@/lib/agent/auto-mode/store')
const body: AgentChatBody = {
  id: 'session',
  permissionMode: 'bypass',
  messages: [{ id: 'first', role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
}

beforeEach(() => docs.clear())

test('Full Access initializes even when transcript sync created the conversation first', async () => {
  for (const conversation of [null, { messageCount: 1 }]) {
    expect(shouldInitializePermissionMode(body, conversation)).toBe(true)
    await initializeSessionBypass(body.id, 'owner', true)
    expect(await getSessionBypass(body.id, 'owner')).toBe(true)
  }
})

test('a retried first turn preserves an explicit switch to Auto Mode', async () => {
  await initializeSessionBypass(body.id, 'owner', true)
  await setSessionBypass(body.id, 'owner', false)
  await initializeSessionBypass(body.id, 'owner', true)
  expect(await getSessionBypass(body.id, 'owner')).toBe(false)
})

test('a retried Auto Mode request preserves an explicit switch to Full Access', async () => {
  await initializeSessionBypass(body.id, 'owner', false)
  await setSessionBypass(body.id, 'owner', true)
  await initializeSessionBypass(body.id, 'owner', false)
  expect(await getSessionBypass(body.id, 'owner')).toBe(true)
})

test('resume, later turns, and paginated history cannot initialize the mode', () => {
  expect(shouldInitializePermissionMode({ ...body, resume: true }, null)).toBe(false)
  expect(shouldInitializePermissionMode(body, { messageCount: 2 })).toBe(false)
  expect(shouldInitializePermissionMode({ ...body, baseIndex: 3 }, null)).toBe(false)
  expect(shouldInitializePermissionMode({ ...body, permissionMode: undefined }, null)).toBe(false)
  expect(
    shouldInitializePermissionMode(
      { ...body, messages: [...body.messages, ...body.messages] },
      null,
    ),
  ).toBe(false)
})

test('the first turn is recognised without a permission mode, and only once', () => {
  const { permissionMode: _mode, ...first } = body

  expect(isFirstTurn(first, null)).toBe(true)
  expect(isFirstTurn(first, { messageCount: 1 })).toBe(true)
  expect(isFirstTurn(first, { messageCount: 3 })).toBe(false)
  expect(isFirstTurn({ ...first, resume: true }, null)).toBe(false)
})
