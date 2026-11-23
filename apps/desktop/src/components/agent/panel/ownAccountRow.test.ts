import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ownAccountRow } from './ownAccountRow.ts'

const you = (login: string) => `You (${login}) · Personal`
const more = (count: number) => `+${count} more`

test('two accounts name the first, count the rest and list both in the tooltip', () => {
  assert.deepEqual(ownAccountRow(['a@x.com', 'b@x.com'], you, more), {
    text: 'You (a@x.com) · Personal',
    title: 'You (a@x.com, b@x.com) · Personal',
    more: '+1 more',
  })
})

test('one account shows no count', () => {
  assert.deepEqual(ownAccountRow(['a@x.com'], you, more), {
    text: 'You (a@x.com) · Personal',
    title: 'You (a@x.com) · Personal',
    more: null,
  })
})
