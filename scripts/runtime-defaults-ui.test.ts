import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  normalizeRuntimeDefaults,
  runtimeDefaultsError,
} from '../apps/desktop/src/views/settings/runtimeDefaults.ts'

test('effort and Fast overrides must match the selected model capabilities', () => {
  const controls = { modelId: 'model', effort: [{ value: 'high', name: 'High' }], fast: false }

  assert.equal(runtimeDefaultsError({ effort: 'high' }, controls), null)
  assert.ok(runtimeDefaultsError({ effort: 'ultra' }, controls))
  assert.ok(runtimeDefaultsError({ fast: 'on' }, controls))
  assert.ok(runtimeDefaultsError({ fast: 'off' }, controls))
  assert.ok(runtimeDefaultsError({ effort: 'high' }, undefined))
  assert.equal(runtimeDefaultsError({}, undefined), null)
})

test('Fast preserves explicit off and clearing an override restores inheritance', () => {
  assert.deepEqual(normalizeRuntimeDefaults({ fast: 'off' }), { fast: 'off' })
  assert.deepEqual(normalizeRuntimeDefaults({ fast: 'on' }), { fast: 'on' })
  assert.deepEqual(normalizeRuntimeDefaults({ fast: undefined, effort: undefined }), {})
})
