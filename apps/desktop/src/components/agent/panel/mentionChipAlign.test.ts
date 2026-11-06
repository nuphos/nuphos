import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const css = readFileSync(new URL('../../../index.css', import.meta.url), 'utf8')
  .split('/*')
  .map((part, i) => (i ? part.slice(part.indexOf('*/') + 2) : part))
  .join('')
// Every rule whose selector targets the chip itself, not its label or icon.
const chipRules = css.split('}').flatMap((chunk) => {
  const [selector = '', body] = chunk.split('{').slice(-2)

  return body !== undefined && /\.atlas-mention(?![-\w])/.test(selector)
    ? [{ selector: selector.trim(), body }]
    : []
})

test('inline chips center on the text line', () => {
  // A flex chip's baseline is its icon's bottom edge, so `baseline` lifts it above the text.
  const base = chipRules.find((r) => r.selector === '.atlas-mention')

  assert.match(base?.body ?? '', /vertical-align:\s*middle;/)
})

test('no chip variant moves off the shared vertical center', () => {
  const overrides = chipRules.filter(
    (r) => r.selector !== '.atlas-mention' && /vertical-align/.test(r.body),
  )

  assert.deepEqual(
    overrides.map((r) => r.selector),
    [],
  )
})
