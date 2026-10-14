import assert from 'node:assert/strict'
import { test } from 'node:test'

import { runtimeFilePathFromHref, runtimeFilePreview } from './runtimeFileLink.ts'

test('resolves agent file links to runtime paths and leaves real URLs alone', () => {
  for (const [href, path] of [
    ['/workspace/repo/src/app.ts', '/workspace/repo/src/app.ts'],
    ['src/app.ts:42', '/workspace/src/app.ts'],
    ['./docs/%E5%A0%B1%E5%91%8A.md#L3', '/workspace/docs/報告.md'],
    ['repo/src/', '/workspace/repo/src/'],
  ])
    assert.equal(runtimeFilePathFromHref(href), path)
  for (const href of [
    'https://nuphos.ai/teams/t/agent',
    '/teams/t/infra/aws',
    'mailto:a@b.c',
    'file:///workspace/report.md',
    '//cdn.example.com/a.js',
    '#section',
    '/',
  ])
    assert.equal(runtimeFilePathFromHref(href), null)
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
