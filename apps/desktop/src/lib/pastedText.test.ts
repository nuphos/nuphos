import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PASTE_CHIP_MIN_CHARS,
  PASTE_CHIP_MIN_LINES,
  encodePastedText,
  pastedLineCount,
  pastedTextLabel,
  pastesAsChip,
  splitPastedText,
} from './pastedText.ts'

const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${String(i + 1)}`).join('\n')
// About 1 MB of log-like text, the size users reported freezing the window.
const huge = 'const value = computeSomething(alpha, beta); // log line 12345\n'.repeat(16_000)

test('a long paste becomes a chip, a short one stays text', () => {
  assert.equal(pastesAsChip('x'.repeat(PASTE_CHIP_MIN_CHARS - 1)), false)
  assert.equal(pastesAsChip('x'.repeat(PASTE_CHIP_MIN_CHARS)), true)
  assert.equal(pastesAsChip(lines(PASTE_CHIP_MIN_LINES - 1)), false)
  assert.equal(pastesAsChip(lines(PASTE_CHIP_MIN_LINES)), true)
  assert.equal(pastesAsChip(huge), true)
})

test('the chip counts lines, not the trailing newline', () => {
  assert.equal(pastedLineCount('one'), 1)
  assert.equal(pastedLineCount('one\ntwo\n'), 2)
  assert.equal(pastedTextLabel('one'), 'Pasted text · 1 line')
  assert.equal(pastedTextLabel(lines(40)), 'Pasted text · 40 lines')
})

test('a sent paste reaches the agent whole and folds back into a chip', () => {
  const pasted = `${lines(40)}\n`
  const sent = `look at this:${encodePastedText(pasted)}what's wrong?`

  assert.ok(sent.includes(pasted))
  assert.deepEqual(splitPastedText(sent), [
    { pasted: false, text: 'look at this:' },
    { pasted: true, text: pasted },
    { pasted: false, text: "what's wrong?" },
  ])
})

test('backtick fences inside a paste never close its block', () => {
  const pasted = 'before\n```js\ncode\n```\n````\nafter'
  const sent = `${encodePastedText(pasted)}${encodePastedText('second')}`

  assert.deepEqual(
    splitPastedText(sent).map((s) => s.text),
    [pasted, 'second'],
  )
})

test('text without a pasted block is left alone', () => {
  assert.deepEqual(splitPastedText('hi ```js\nx\n```'), [
    { pasted: false, text: 'hi ```js\nx\n```' },
  ])
})

test('a 1 MB paste is decided, sent and folded back quickly', () => {
  const start = performance.now()

  assert.equal(pastesAsChip(huge), true)
  const sent = `see${encodePastedText(huge)}`
  const [, back] = splitPastedText(sent)

  assert.equal(back.text, huge)
  // Linear work on 1 MB takes a few ms; the old per-word insert took minutes.
  assert.ok(performance.now() - start < 250, `took ${String(performance.now() - start)}ms`)
})
