import assert from 'node:assert/strict'
import { before, mock, test } from 'node:test'

import type { Message } from './model'

let toUiMessages: typeof import('./toUiMessages.ts').toUiMessages
let toPersistedMessages: typeof import('./toUiMessages.ts').toPersistedMessages

before(async () => {
  mock.module('./clientTools.ts', {
    namedExports: { finalizeIncompleteTools: (messages: Message[]) => messages },
  })
  mock.module('./parts.ts', { namedExports: { isHiddenMemoryIngestPart: () => false } })
  mock.module('./stall.ts', { namedExports: { INTERRUPTED_TOOL_MESSAGE: 'interrupted' } })
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
    attachmentId: 'att_1',
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
          attachmentId: image.attachmentId,
        },
      ],
    },
  ])
  assert.deepEqual(toPersistedMessages(messages)[0].parts[1], image)
  assert.ok(!JSON.stringify(toUiMessages(messages)).includes('upload_attachment'))
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
