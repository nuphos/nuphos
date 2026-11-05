import assert from 'node:assert/strict'
import test from 'node:test'

import { pastePieces } from './composerPaste.ts'

const isUrl = (text: string) => text.startsWith('https://nuphos.ai/')
const joined = (pieces: ReturnType<typeof pastePieces>) =>
  pieces.map((p) => ('url' in p ? p.url : p.text)).join('')

test('Nuphos links become chips and the text around them stays as typed', () => {
  const raw = 'see https://nuphos.ai/teams/t/plans/1 then https://nuphos.ai/teams/t/plans/2 ok'
  const pieces = pastePieces(raw, isUrl)

  assert.deepEqual(pieces, [
    { text: 'see ' },
    { url: 'https://nuphos.ai/teams/t/plans/1' },
    { text: ' then ' },
    { url: 'https://nuphos.ai/teams/t/plans/2' },
    { text: ' ok' },
  ])
  assert.equal(joined(pieces), raw)
})

test('a long paste is one insert, not one per word', () => {
  // Each insert fires an input event that re-reads the editor; one per word
  // froze the window for minutes on a 1 MB paste.
  const huge = 'const value = computeSomething(alpha, beta); // log line 12345\n'.repeat(16_000)
  const withLinks = `${huge}https://nuphos.ai/teams/t/plans/1\n${huge}`
  const start = performance.now()

  assert.deepEqual(pastePieces(huge, isUrl), [{ text: huge }])
  assert.equal(pastePieces(withLinks, isUrl).length, 3)
  assert.ok(performance.now() - start < 1000, `took ${String(performance.now() - start)}ms`)
})
