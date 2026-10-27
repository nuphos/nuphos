import { expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { persistedMessageToUiMessage } from '@/routes/mcp/transcript'

import { appendConversationMessages } from './transcript'

type Doc = {
  sessionId: string
  userId: string
  index: number
  messageId: string
  role: 'user' | 'assistant'
  parts: unknown[]
}
type Upsert = { updateOne: { filter: { index: number }; update: { $set: Partial<Doc> } } }

const SESSION = 'session'
const OWNER = 'owner'
const doc = (index: number, messageId: string, role: Doc['role'], parts: unknown[]): Doc => ({
  sessionId: SESSION,
  userId: OWNER,
  index,
  messageId,
  role,
  parts,
})
// What the model-facing history converter cannot represent: an attachment-only
// message, and the steering receipt inside an assistant reply.
const store: Doc[] = [
  doc(0, 'photo', 'user', [
    { type: 'transfer-upload', groupId: 'a'.repeat(24), status: 'ready', files: [] },
  ]),
  doc(1, 'reply', 'assistant', [
    { type: 'text', text: 'working on it' },
    { type: 'data-steering', data: { id: 'steer-1', text: 'also check the logs' } },
    { type: 'text', text: 'done' },
  ]),
]
const before = JSON.stringify(store)

useDb({
  db: () => ({
    collection: () => ({
      find: () => ({ toArray: () => Promise.resolve(store.map((d) => ({ ...d }))) }),
      updateOne: () => Promise.resolve({ upsertedCount: 0 }),
      deleteMany: () => Promise.reject(new Error('a turn must not delete stored messages')),
      bulkWrite: (ops: Upsert[]) => {
        for (const { updateOne } of ops) {
          const at = store.findIndex((d) => d.index === updateOne.filter.index)

          if (at >= 0) throw new Error(`a turn rewrote stored index ${String(at)}`)
          store.push({ ...doc(updateOne.filter.index, '', 'user', []), ...updateOne.update.$set })
        }

        return Promise.resolve({})
      },
    }),
  }),
})

/** One agent.thread or trigger turn: history rebuilt the lossy way, plus what it adds. */
async function turn(user: string, reply: string) {
  const history = store
    .map(persistedMessageToUiMessage)
    .filter((message) => message !== null)
    .map(({ id, role, parts }) => ({ id, role: role as Doc['role'], parts: parts as unknown[] }))
  const asked = [...history, { id: user, role: 'user' as const, parts: [{ type: 'text', text: user }] }]
  const sync = (messages: typeof asked) =>
    appendConversationMessages({
      sessionId: SESSION,
      userId: OWNER,
      title: '',
      firstMessage: 'first',
      messages,
      preserveTitle: true,
    })

  await sync(asked)

  return await sync([...asked, { id: reply, role: 'assistant', parts: [{ type: 'text', text: reply }] }])
}

test('agent and trigger turns keep stored messages their history cannot represent', async () => {
  // The rebuilt history really is lossy: the photo is gone, the receipt stripped.
  expect(store.map(persistedMessageToUiMessage).map((m) => m?.parts.length ?? 0)).toEqual([0, 2])

  expect((await turn('agent-thread', 'agent-reply')).count).toBe(4)
  expect((await turn('trigger', 'trigger-reply')).count).toBe(6)

  expect(JSON.stringify(store.slice(0, 2))).toBe(before)
  expect(store.map((d) => [d.index, d.messageId])).toEqual([
    [0, 'photo'],
    [1, 'reply'],
    [2, 'agent-thread'],
    [3, 'agent-reply'],
    [4, 'trigger'],
    [5, 'trigger-reply'],
  ])
})
