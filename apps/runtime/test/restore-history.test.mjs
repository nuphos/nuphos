import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PassThrough } from 'node:stream'
import {
  nuphosListenJsonLines,
  nuphosOmitRestoreImages,
} from '../image/codex-acp/restore-history.mjs'

test('reader handles fragmented UTF-8 and large lines, and detaches on dispose', async () => {
  const input = new PassThrough()
  const messages = []
  const reader = nuphosListenJsonLines(input, (m) => messages.push(m))
  const value = {
    id: 1,
    result: {
      text: '圖片',
      payload: 'x'.repeat(1024 * 1024),
      image: 'data:image/png;base64,live-image',
    },
  }
  const buffer = Buffer.from(JSON.stringify(value) + '\ninvalid\n{"id":2}\n')
  for (let i = 0; i < buffer.length; i += 113) input.write(buffer.subarray(i, i + 113))
  assert.deepEqual(messages, [
    { ...value, jsonrpc: '2.0' },
    { id: 2, jsonrpc: '2.0' },
  ])
  reader.dispose()
  input.end('{"id":3}\n')
  assert.equal(messages.length, 2)
})

test('restore omits inline images while retaining text, paths, URLs and tool metadata', () => {
  const history = {
    turns: [
      {
        items: [
          {
            type: 'userMessage',
            content: [
              { type: 'text', text: 'keep me' },
              { type: 'image', url: 'data:image/png;base64,abc' },
              { type: 'image', url: 'https://example.com/image.png' },
            ],
          },
          {
            type: 'imageGeneration',
            id: 'gen',
            result: 'base64',
            savedPath: '/image.png',
            revisedPrompt: 'keep prompt',
          },
          {
            type: 'tool',
            content: [
              { type: 'image', data: 'abc', mimeType: 'image/png' },
              { type: 'text', text: 'tool result' },
            ],
          },
        ],
      },
    ],
  }
  const result = nuphosOmitRestoreImages(structuredClone(history))
  const items = result.turns[0].items
  assert.equal(items[0].content[0].text, 'keep me')
  assert.equal(items[0].content[1].url, '[Image omitted during restore]')
  assert.equal(items[0].content[2].url, 'https://example.com/image.png')
  assert.deepEqual(items[1], { ...history.turns[0].items[1], result: '' })
  assert.deepEqual(items[2].content, [
    { type: 'text', text: '[Image omitted during restore]' },
    { type: 'text', text: 'tool result' },
  ])
  assert.equal(history.turns[0].items[1].result, 'base64')
})
