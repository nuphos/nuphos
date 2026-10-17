import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  isRuntimeFilePath,
  runtimeFilePathFromHref,
  runtimeFilePreview,
  splitRuntimeFilePaths,
} from './runtimeFileLink.ts'

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

test('finds bare runtime paths in prose without catching URLs, dates or app routes', () => {
  assert.deepEqual(
    splitRuntimeFilePaths('存在 /data/workspace/videos/影片.mp4。看 /workspace/src/app.ts:42 吧'),
    [
      '存在 ',
      { path: '/data/workspace/videos/影片.mp4' },
      '。看 ',
      { path: '/workspace/src/app.ts:42' },
      ' 吧',
    ],
  )
  assert.deepEqual(splitRuntimeFilePaths('saved to /srv/out.log.'), [
    'saved to ',
    { path: '/srv/out.log' },
    '.',
  ])
  for (const text of [
    'https://nuphos.ai/teams/t/agent',
    '2026/10/16',
    'TCP/UDP and/or',
    '/usr',
    'open /teams/t/infra/aws',
    '~/notes/a.md',
    'GET /api/v1/monitors',
    'see /api/datasources',
    'POST /v1/messages',
    'https://x/a/b',
    '1/2',
    '/',
    'C:\\Users\\a\\b',
    'C:/Users/a/b',
  ])
    assert.ok(
      splitRuntimeFilePaths(text).every((part) => typeof part === 'string'),
      text,
    )
  for (const text of ['(see /data/a.md)', '/data/a.md,', '/data/a.md:', '/data/a.md).'])
    assert.deepEqual(
      splitRuntimeFilePaths(text).filter((part) => typeof part !== 'string'),
      [{ path: '/data/a.md' }],
      text,
    )
  assert.ok(isRuntimeFilePath(' /data/workspace/a.mp4 '))
  assert.ok(!isRuntimeFilePath('cat /data/workspace/a.mp4'))
})
