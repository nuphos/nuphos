import assert from 'node:assert/strict'
import { test } from 'node:test'

import { unbundledStatus } from './localAgentBundle.ts'

test('a packaged build without the agent keeps its plain copy', () => {
  assert.deepEqual(unbundledStatus('Codex'), {
    label: 'This build of Nuphos does not include Codex.',
    tone: 'off',
  })
})

test('a dev build says what bun run dev is doing about the missing bundle', () => {
  assert.equal(unbundledStatus('Codex', { state: 'preparing' }).tone, 'pending')
  assert.match(unbundledStatus('Codex', { state: 'preparing' }).label, /bun run dev builds it/)
  const failed = unbundledStatus('Codex', { state: 'failed', reason: 'Install git' })

  assert.equal(failed.tone, 'error')
  assert.match(failed.label, /Install git/)
  assert.match(
    unbundledStatus('Codex', { state: 'missing' }).label,
    /node apps\/desktop\/local-runtime\/prepare\.mjs/,
  )
})
