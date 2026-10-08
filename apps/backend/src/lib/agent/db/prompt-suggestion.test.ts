import { expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { setConversationPreviewContext } from './conversations'
import {
  openConversationPromptSuggestion,
  setConversationPromptSuggestion,
} from './conversations-runtime'

type Doc = Record<string, unknown>
let doc: Doc = {}

const read = (path: string) =>
  path.split('.').reduce<unknown>((value, key) => (value as Doc | undefined)?.[key], doc)

// Equality filters and $set on dotted paths: all these writes use.
useDb({
  db: () =>
    ({
      collection: () => ({
        updateOne: async (filter: Doc, update: { $set: Doc }) => {
          if (!Object.entries(filter).every(([path, value]) => read(path) === value)) return
          for (const [path, value] of Object.entries(update.$set)) {
            const [head, leaf] = path.split('.') as [string, string?]

            if (leaf === undefined) doc[head] = value
            else doc[head] = { ...(doc[head] as Doc | undefined), [leaf]: value }
          }
        },
      }),
    }) as unknown as ReturnType<typeof import('@/lib/db').db>,
})

const suggestion = () => read('claudeCodePreviewContext.promptSuggestion')

test('a guess lands on the turn that just ended', async () => {
  doc = { sessionId: 's', teamId: 't' }
  await setConversationPreviewContext('s', 't', { activeTurnKey: 'turn-1' })
  await openConversationPromptSuggestion('s', 't', 'turn-1')
  await setConversationPromptSuggestion('s', 't', 'run the tests')

  expect(suggestion()).toBe('run the tests')
})

test('a guess that arrives after the next turn started is dropped', async () => {
  doc = { sessionId: 's', teamId: 't' }
  await setConversationPreviewContext('s', 't', { activeTurnKey: 'turn-1' })
  await openConversationPromptSuggestion('s', 't', 'turn-1')
  await setConversationPreviewContext('s', 't', { activeTurnKey: 'turn-2' })
  await setConversationPromptSuggestion('s', 't', 'stale guess for turn 1')

  expect(suggestion()).toBeUndefined()
})

test('only the first guess fills the slot', async () => {
  doc = { sessionId: 's', teamId: 't' }
  await setConversationPreviewContext('s', 't', { activeTurnKey: 'turn-1' })
  await openConversationPromptSuggestion('s', 't', 'turn-1')
  await setConversationPromptSuggestion('s', 't', 'first')
  await setConversationPromptSuggestion('s', 't', 'second')

  expect(suggestion()).toBe('first')
})
