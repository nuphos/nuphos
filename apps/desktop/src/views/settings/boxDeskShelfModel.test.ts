import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createElement } from 'react'

import { shelfEdges, shelfWatchKey } from './boxDeskShelfModel.ts'

const machines = (n: number) =>
  Array.from({ length: n }, (_, i) => createElement('li', { key: String(i) }))

test('the observers outlive a re-render with the same machines, not a new machine', () => {
  // A metrics poll builds new elements for the same machines: the key must not change.
  assert.equal(shelfWatchKey(machines(6)), shelfWatchKey(machines(6)))
  assert.notEqual(shelfWatchKey(machines(6)), shelfWatchKey(machines(7)))
})

test('each edge with more machines is marked, with a pixel of slack', () => {
  assert.deepEqual(shelfEdges({ scrollLeft: 0, clientWidth: 1056, scrollWidth: 2032 }), {
    left: false,
    right: true,
  })
  assert.deepEqual(shelfEdges({ scrollLeft: 976, clientWidth: 1056, scrollWidth: 2032 }), {
    left: true,
    right: false,
  })
  assert.deepEqual(shelfEdges({ scrollLeft: 975.5, clientWidth: 1056, scrollWidth: 2032 }), {
    left: true,
    right: false,
  })
  assert.deepEqual(shelfEdges({ scrollLeft: 0, clientWidth: 1632, scrollWidth: 1632 }), {
    left: false,
    right: false,
  })
})
