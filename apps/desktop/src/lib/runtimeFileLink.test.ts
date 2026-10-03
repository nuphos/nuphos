import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseRuntimeFileLink, runtimeFilePreview } from './runtimeFileLink.ts'

test('pins the file to the explicit runtime and conversation, including encoded local IDs', () => {
  assert.deepEqual(
    parseRuntimeFileLink(
      'https://nuphos.ai/teams/t/agent-runtimes/local%3Au%3Ad%3Acodex/files/content?sessionId=s&path=%E5%A0%B1%E5%91%8A.md',
    ),
    {
      teamId: 't',
      runtimeId: 'local:u:d:codex',
      sessionId: 's',
      path: '報告.md',
    },
  )
  for (const url of [
    'file:///workspace/report.md',
    'https://evil.test/teams/t/agent-runtimes/r/files/content?sessionId=s&path=a',
    'https://nuphos.ai/teams/t/agent-runtimes/r/files/content?path=a',
  ])
    assert.equal(parseRuntimeFileLink(url), null)
})

test('renders HTML and SVG as inert text and rejects binary', () => {
  for (const text of ['<script>alert(1)</script>', '<svg onload="alert(1)"/>', ''])
    assert.deepEqual(
      runtimeFilePreview({
        name: 'file',
        data: Buffer.from(text).toString('base64'),
        size: text.length,
      }),
      { text },
    )
  assert.equal(runtimeFilePreview({ name: 'file', data: 'AA==', size: 1 }), null)
})
