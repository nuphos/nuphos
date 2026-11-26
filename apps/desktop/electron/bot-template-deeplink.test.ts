import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseBotTemplateUrl } from './bot-template-deeplink.ts'

test('reads a pinned template selection without authenticated bindings', () => {
  assert.deepEqual(parseBotTemplateUrl('nuphos://bot-template?id=nuphos-guide&version=1.0.0'), {
    id: 'nuphos-guide',
    version: '1.0.0',
  })
})
test('rejects ambiguous or untrusted links', () => {
  for (const value of [
    'https://bot-template?id=nuphos-guide&version=1.0.0',
    'nuphos://evil@bot-template?id=nuphos-guide&version=1.0.0',
    'nuphos://bot-template/other?id=nuphos-guide&version=1.0.0',
    'nuphos://bot-template?id=nuphos-guide&id=other&version=1.0.0',
    'nuphos://bot-template?id=../secret&version=1.0.0',
    'nuphos://bot-template?id=nuphos-guide&version=latest',
    'nuphos://bot-template?id=nuphos-guide&version=1.0.0&url=https://evil.test',
  ])
    assert.equal(parseBotTemplateUrl(value), null, value)
})
