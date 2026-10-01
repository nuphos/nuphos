import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  defaultPermissions,
  detectPreset,
  grantNotices,
  normalizePermissions,
} from './posthogPermissions.ts'

import type { PosthogScopeCatalog } from '../types/posthog.ts'

const catalog: PosthogScopeCatalog = {
  fixedScopes: ['user:read', 'project:read'],
  resources: [
    { id: 'query', label: 'Query', description: '', writable: false, writeWarning: null },
    { id: 'insight', label: 'Insights', description: '', writable: true, writeWarning: null },
    {
      id: 'feature_flag',
      label: 'Feature flags',
      description: '',
      writable: true,
      writeWarning: 'Changes production behaviour',
    },
  ],
  presets: [
    {
      id: 'read_only',
      label: 'Read only',
      permissions: { query: 'read', insight: 'read', feature_flag: 'read' },
    },
    {
      id: 'read_write',
      label: 'Read & write',
      permissions: { query: 'read', insight: 'write', feature_flag: 'write' },
    },
  ],
}

describe('PostHog permissions', () => {
  test('recognises each preset and falls back to custom', () => {
    assert.equal(detectPreset(catalog, defaultPermissions(catalog)), 'read_only')
    assert.equal(
      detectPreset(catalog, { query: 'read', insight: 'write', feature_flag: 'write' }),
      'read_write',
    )
    assert.equal(
      detectPreset(catalog, { query: 'read', insight: 'write', feature_flag: 'read' }),
      'custom',
    )
    assert.equal(detectPreset(catalog, { query: 'read' }), 'custom')
  })

  test('fills missing resources, drops unknown ids and caps read-only resources', () => {
    assert.deepEqual(normalizePermissions(catalog, { query: 'write', unknown: 'write' }), {
      query: 'read',
      insight: 'none',
      feature_flag: 'none',
    })
  })

  test('describes requested-versus-granted differences', () => {
    assert.deepEqual(grantNotices({ missingScopes: [], extraScopes: [] }), [])
    assert.deepEqual(
      grantNotices({ missingScopes: ['insight:write'], extraScopes: ['cohort:read'] }),
      [
        { kind: 'missing', text: 'PostHog granted less than requested: insight:write' },
        { kind: 'extra', text: 'PostHog granted more than requested: cohort:read' },
      ],
    )
  })
})
