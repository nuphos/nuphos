import assert from 'node:assert/strict'
import { before, beforeEach, mock, test } from 'node:test'

import type { Tab } from './model.ts'

let syncTranscriptNow: (tab: Tab) => void
let uploads: unknown[] = []
let refreshes = 0
const identity = (value: unknown) => value

before(async () => {
  mock.module('react', {
    namedExports: { useCallback: (fn: unknown) => fn, useMemo: (fn: () => unknown) => fn() },
  })
  mock.module('../../../api.ts', {
    namedExports: {
      api: {
        agentSyncConversationTranscript: (args: unknown) => {
          uploads.push(args)

          return Promise.resolve()
        },
      },
    },
  })
  // Credential selection is outside this test; keep its imports out of the graph.
  mock.module('./credentialAccess.ts', {
    namedExports: {
      credentialOptionsLoaded: () => false,
      defaultCredentialAccess: identity,
      normalizeCredentialAccess: identity,
      pruneCredentialAccessToOptions: identity,
    },
  })
  mock.module('./credentialRequest.ts', {
    namedExports: { includeBoundOnpremCredential: identity },
  })
  mock.module('./persistence.ts', { namedExports: { transcriptSignature: JSON.stringify } })
  mock.module('./toUiMessages.ts', { namedExports: { toPersistedMessages: identity } })
  const { usePanelTranscripts } = await import('./usePanelTranscripts.ts')

  syncTranscriptNow = usePanelTranscripts({
    credentialOptions: null,
    credentialOptionsRef: { current: null },
    lastSyncedRef: { current: new Map() },
    refreshHistory: async () => {
      refreshes++
    },
    teamId: 'team',
  } as unknown as Parameters<typeof usePanelTranscripts>[0]).syncTranscriptNow
})

beforeEach(() => {
  uploads = []
  refreshes = 0
})

const tab = (overrides: Partial<Tab>) =>
  ({
    id: 'tab',
    sessionId: 'session',
    title: 'Chat',
    streaming: false,
    messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
    ...overrides,
  }) as Tab

test('a runtime conversation never uploads its transcript, mid-turn or after it', async () => {
  syncTranscriptNow(tab({ agentRuntime: 'claude-code', streaming: true }))
  syncTranscriptNow(tab({ agentRuntime: 'claude-code', streaming: false }))
  await Promise.resolve()

  assert.deepEqual(uploads, [])
  // The ended turn still refreshes the conversation's runtime attachment.
  assert.equal(refreshes, 1)
})

test('a conversation without a runtime still uploads its transcript', async () => {
  syncTranscriptNow(tab({ sessionId: 'legacy' }))
  await Promise.resolve()

  assert.equal(uploads.length, 1)
})
