import assert from 'node:assert/strict'
import { test } from 'node:test'

import { channelFiles } from './channelFiles.ts'

import type { AgentPersistedMessage } from '../../api/agent-types'

const post = (parts: unknown[]) => ({ id: 'm', role: 'user', parts }) as AgentPersistedMessage

test('a post’s uploads and an agent’s pushed files are its files; words are not', () => {
  const files = channelFiles(
    post([
      { type: 'text', text: 'Here are the clips.' },
      { type: 'transfer-upload', groupId: 'u1', files: [{ fileName: 'a.png' }] },
      { type: 'transfer-download', groupId: 'd1' },
    ]),
  )

  assert.deepEqual(
    files.uploads.map((part) => part.groupId),
    ['u1'],
  )
  assert.deepEqual(files.downloads, ['d1'])
  assert.equal(files.any, true)
  assert.equal(channelFiles(post([{ type: 'text', text: 'hi' }])).any, false)
})
