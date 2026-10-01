import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseDevOptions } from './dev-options.ts'

test('desktop is the default frontend', () => {
  assert.deepEqual(parseDevOptions([]), { mode: 'desktop', reset: false, managed: null })
})

test('--admin selects the Admin frontend', () => {
  assert.deepEqual(parseDevOptions(['--admin']), { mode: 'admin', reset: false, managed: null })
})

test('--reset wipes the stack first, in either mode', () => {
  assert.deepEqual(parseDevOptions(['--admin', '--reset']), {
    mode: 'admin',
    reset: true,
    managed: null,
  })
})

test('--managed runs managed agents on OrbStack unless it names another context', () => {
  assert.equal(parseDevOptions(['--managed']).managed, 'orbstack')
  assert.equal(parseDevOptions(['--managed=kind-nuphos']).managed, 'kind-nuphos')
  assert.equal(parseDevOptions(['--managed=kind-a', '--managed']).managed, 'orbstack')
})
