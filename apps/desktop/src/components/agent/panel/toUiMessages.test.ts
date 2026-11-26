import assert from 'node:assert/strict'
import { before, mock, test } from 'node:test'

import type { Message } from './model'

let toUiMessages: typeof import('./toUiMessages.ts').toUiMessages
let toPersistedMessages: typeof import('./toUiMessages.ts').toPersistedMessages

before(async () => {
  mock.module('../../../api.ts', { namedExports: { isNetworkError: () => false } })
  mock.module('../../../i18n/index.ts', { namedExports: { t: (text: string) => text } })
  mock.module('../../../lib/analytics.ts', {
    namedExports: { track: () => {}, trackError: () => {} },
  })
  mock.module('../../../lib/frontendErrorReporter.ts', {
    namedExports: { reportFrontendError: () => {} },
  })
  mock.module('../../../lib/ownedAgentStreams.ts', {
    namedExports: { markOwnedAgentStream: () => {} },
  })
  ;({ toUiMessages, toPersistedMessages } = await import('./toUiMessages.ts'))
})

test('native text phase and identity survive requests and transcript sync', () => {
  const parts = [
    { type: 'text' as const, text: 'Progress', messageId: 'p', phase: 'commentary' as const },
    { type: 'text' as const, text: 'Answer', messageId: 'f', phase: 'final_answer' as const },
  ]
  const messages: Message[] = [{ id: 'a', role: 'assistant', parts }]

  assert.deepEqual((toUiMessages(messages)[0] as Message).parts, parts)
  assert.deepEqual(toPersistedMessages(messages)[0].parts, parts)
})

test('image identity stays structured in requests and transcript sync', () => {
  const image = {
    type: 'image' as const,
    mediaType: 'image/png',
    url: 'data:image/png;base64,aGVsbG8=',
    fileName: 'screen.png',
    path: '/local/screen.png',
  }
  const messages: Message[] = [
    { id: 'first', role: 'user', parts: [{ type: 'text', text: 'Read this' }, image] },
  ]

  assert.deepEqual(toUiMessages(messages), [
    {
      id: 'first',
      role: 'user',
      parts: [
        { type: 'text', text: 'Read this' },
        {
          type: 'file',
          mediaType: image.mediaType,
          url: image.url,
          filename: image.fileName,
        },
      ],
    },
  ])
  assert.deepEqual(toPersistedMessages(messages)[0].parts[1], image)
})

test('ready files travel as structured attachments; unfinished uploads never reach the agent', () => {
  const transfer = {
    type: 'transfer-upload' as const,
    groupId: 'g',
    status: 'ready' as const,
    files: [{ fileName: 'report.txt', size: 6, status: 'ready' }],
  }

  assert.deepEqual(toUiMessages([{ id: 'f', role: 'user', parts: [transfer] }]), [
    { id: 'f', role: 'user', parts: [{ type: 'data-attachment', data: transfer }] },
  ])
  assert.deepEqual(
    toUiMessages([{ id: 'f', role: 'user', parts: [{ ...transfer, status: 'uploading' }] }]),
    [],
  )
})

const memory = (text: string) => ({
  type: 'memory-ingest' as const,
  id: text,
  sessionId: 's',
  kind: 'ok' as const,
  text,
  createdAt: '2026-01-01T00:00:00Z',
})

test('a queued memory note is not persisted; a finished one is', () => {
  const messages: Message[] = [
    { id: 'a', role: 'assistant', parts: [memory('Queued for memory'), memory('Saved 1 memory')] },
  ]

  assert.deepEqual(
    toPersistedMessages(messages)[0].parts.map((part) => ('id' in part ? part.id : part.type)),
    ['Saved 1 memory'],
  )
})
