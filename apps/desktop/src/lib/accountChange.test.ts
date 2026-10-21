import assert from 'node:assert/strict'
import { test } from 'node:test'

import { takeAccountChange } from './accountChange.ts'

test('the account change is read once and taken out of the address', () => {
  const replaced: string[] = []
  const history = {
    state: null,
    replaceState: (_state: unknown, _title: string, url?: string | URL | null) => {
      replaced.push(String(url))
    },
  } as unknown as History

  assert.equal(
    takeAccountChange({ href: 'file:///app/index.html?account=added' }, history),
    'added',
  )
  assert.deepEqual(replaced, ['file:///app/index.html'])
  assert.equal(takeAccountChange({ href: 'file:///app/index.html' }, history), null)
  assert.equal(takeAccountChange({ href: 'file:///app/index.html?account=x' }, history), null)
})
