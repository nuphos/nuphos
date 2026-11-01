import assert from 'node:assert/strict'
import test from 'node:test'

import { afterAnswer } from './shareTrust.ts'

const request = (id: string, actorId: string, deviceId = 'mac') => ({ id, actorId, deviceId })
const first = request('a', 'mate')
const list = [first, request('b', 'mate'), request('c', 'mate', 'mini'), request('d', 'other')]

test('a plain answer removes only that request', () => {
  assert.deepEqual(
    afterAnswer(list, first, undefined).map((entry) => entry.id),
    ['b', 'c', 'd'],
  )
})

test('approving with trust removes that teammate’s requests on that computer', () => {
  assert.deepEqual(
    afterAnswer(list, first, '8h').map((entry) => entry.id),
    ['c', 'd'],
  )
})
