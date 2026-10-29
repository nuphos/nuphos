import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DESK_OPEN_AFTER_MS, DESK_OPENING_MS, deskModel, deskOpenDelay } from './boxDeskModel.ts'

import type { AgentDevice } from '../../api/device-types.ts'

const machine = (platform: string, model?: string, box?: AgentDevice['box']) =>
  deskModel({ deviceId: 'd', label: 'D', platform, model, box } as AgentDevice)

test('a Mac is drawn as what its model name says it is', () => {
  assert.deepEqual(machine('darwin', 'MacBook Pro'), { form: 'laptop', brand: 'apple' })
  assert.deepEqual(machine('darwin', 'MacBook Air'), { form: 'laptop', brand: 'apple' })
  assert.deepEqual(machine('darwin', 'Mac mini'), { form: 'box', brand: 'apple' })
  assert.deepEqual(machine('darwin', 'Mac Studio'), { form: 'box', brand: 'apple' })
  assert.deepEqual(machine('darwin', 'iMac'), { form: 'box', brand: 'apple' })
})

test('a Mac that names no model is drawn as a MacBook', () => {
  assert.deepEqual(machine('darwin'), { form: 'laptop', brand: 'apple' })
})

test('anything not Apple is a laptop: Windows in its own finish, the rest plain', () => {
  assert.deepEqual(machine('win32'), { form: 'laptop', brand: 'windows' })
  assert.deepEqual(machine('linux'), { form: 'laptop', brand: 'other' })
  assert.deepEqual(machine('freebsd'), { form: 'laptop', brand: 'other' })
})

test('a Box is a Nuphos box, whatever it runs', () => {
  const box = { provider: 'instabox', sandboxId: 'sb', state: 'running' } as AgentDevice['box']

  assert.deepEqual(machine('linux', undefined, box), { form: 'box', brand: 'nuphos' })
})

test('every machine on the page opens at the same moment, then the page opens afresh', () => {
  const wave = { at: -Infinity }

  assert.equal(deskOpenDelay(1000, wave), DESK_OPEN_AFTER_MS)
  // Rows that arrive a little later join the same opening instead of starting their own.
  assert.equal(deskOpenDelay(1100, wave), DESK_OPEN_AFTER_MS - 100)
  assert.equal(deskOpenDelay(1600, wave), 0)
  assert.equal(wave.at, 1000 + DESK_OPEN_AFTER_MS)
  // Long after, a newly shown page gets a fresh opening.
  assert.equal(
    deskOpenDelay(1000 + DESK_OPEN_AFTER_MS + DESK_OPENING_MS + 1, wave),
    DESK_OPEN_AFTER_MS,
  )
})

test('the slowest part of an opening ends 1.25 s in, so the whole thing takes 1.5 s', () => {
  assert.equal(DESK_OPEN_AFTER_MS + DESK_OPENING_MS, 1500)
})
