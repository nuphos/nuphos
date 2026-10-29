import assert from 'node:assert/strict'
import { test } from 'node:test'

import { longLivedSignIn } from './longLivedSignIn.ts'

const now = Date.parse('2026-10-29T12:00:00Z')

test('a fresh one-year token says when it expires and offers nothing', () => {
  const view = longLivedSignIn('2027-10-29T12:00:00Z', now)

  assert.equal(view.renew, false)
  assert.match(
    view.note,
    /^Signed in with a one-year token that never needs refreshing\. It expires on /,
  )
})

test('the last month offers renewing, and a lapsed token says so', () => {
  assert.deepEqual(longLivedSignIn('2026-11-08T12:00:00Z', now), {
    note: 'Signed in with a one-year token that expires in 10 days. Sign in again to renew it.',
    renew: true,
  })
  assert.equal(longLivedSignIn('2026-10-28T12:00:00Z', now).renew, true)
  assert.match(longLivedSignIn('2026-10-28T12:00:00Z', now).note, /has expired/)
})
