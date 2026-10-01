import assert from 'node:assert/strict'
import { test } from 'node:test'

import { monitoringItemPath } from './monitoringLink.ts'

test('monitoringItemPath preserves the exact provider resource identity', () => {
  assert.equal(
    monitoringItemPath('team/1', {
      provider: 'gcp',
      integrationId: 'binding 1',
      kind: 'alert-policy',
      providerResourceId: 'projects/prod/alertPolicies/policy-1',
    }),
    '/teams/team%2F1/monitoring/gcp/binding%201/alert-policy/projects%2Fprod%2FalertPolicies%2Fpolicy-1',
  )
})
