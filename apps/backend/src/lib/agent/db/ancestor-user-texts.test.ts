import { beforeEach, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { ancestorUserTexts } from './ancestor-user-texts'

import type * as dbActual from '@/lib/db'

type Doc = Record<string, unknown>

const matches = (doc: Doc, filter: Doc) =>
  Object.entries(filter).every(([key, want]) => doc[key] === want)

let conversations: Doc[] = []
let messages: Doc[] = []

useDb({
  db: (() => ({
    collection: (name: string) => {
      const docs = () => (name.includes('message') ? messages : conversations)

      return {
        findOne: async (filter: Doc) => docs().find((doc) => matches(doc, filter)) ?? null,
        find: (filter: Doc) => {
          const found = docs().filter((doc) => matches(doc, filter))
          const cursor = {
            sort: () => cursor,
            limit: () => cursor,
            toArray: async () => [...found].reverse(),
          }

          return cursor
        },
      }
    },
  })) as unknown as typeof dbActual.db,
})

const sentAt = '2026-11-18T00:00:00Z'
const typed = (sessionId: string, index: number, text: string) => ({
  sessionId,
  userId: 'u',
  index,
  role: 'user',
  parts: [{ type: 'text', text }],
  metadata: {
    version: 1,
    sender: { type: 'user', id: 'u', displayName: 'Owner' },
    source: 'nuphos',
    sentAt,
  },
})
const delegated = (sessionId: string, index: number, text: string, from: string) => ({
  sessionId,
  userId: 'u',
  index,
  role: 'user',
  parts: [{ type: 'text', text }],
  metadata: {
    version: 1,
    sender: { type: 'agent', id: from, displayName: 'Parent' },
    source: 'agent.thread',
    sourceSessionId: from,
    sentAt,
  },
})

beforeEach(() => {
  conversations = [
    { sessionId: 'root', userId: 'u', teamId: 't' },
    { sessionId: 'lead', userId: 'u', teamId: 't', parentSessionId: 'root' },
    { sessionId: 'worker', userId: 'u', teamId: 't', parentSessionId: 'lead' },
  ]
  messages = [
    typed('root', 0, '請幫我把這兩個問題修好'),
    delegated('lead', 0, 'Fix both problems and report back.', 'root'),
    delegated('worker', 0, 'Open an issue for problem A.', 'lead'),
  ]
})

test('a thread no person wrote in takes the language of the nearest ancestor someone wrote in', async () => {
  expect(await ancestorUserTexts('worker')).toEqual(['請幫我把這兩個問題修好'])
})

test('the nearest ancestor with a typed message wins', async () => {
  messages.push(typed('lead', 1, 'Please keep it short.'))

  expect(await ancestorUserTexts('worker')).toEqual(['Please keep it short.'])
})

test("another owner's parent ends the chain", async () => {
  conversations[0] = { sessionId: 'root', userId: 'someone-else', teamId: 't' }

  expect(await ancestorUserTexts('worker')).toEqual([])
})

test('a conversation without a parent has no ancestor to ask', async () => {
  expect(await ancestorUserTexts('root')).toEqual([])
})
