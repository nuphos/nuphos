import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  customResourceNavigationKey,
  customResourceNavigationMetadata,
  parseCustomResourceNavigationKey,
} from './customResourceNavigation.ts'

test('custom resource navigation keys round-trip the served CRD identity', () => {
  const resource = {
    apiVersion: 'gateway.networking.k8s.io/v1',
    kind: 'HTTPRoute',
    plural: 'httproutes',
    namespaced: true,
  }

  assert.deepEqual(
    parseCustomResourceNavigationKey(customResourceNavigationKey(resource)),
    resource,
  )
})

test('custom resource navigation rejects malformed keys', () => {
  assert.equal(parseCustomResourceNavigationKey('custom.resource:not:enough'), null)
  assert.equal(parseCustomResourceNavigationKey('workloads.pods'), null)
})

test('custom resource navigation metadata labels type-specific destinations', () => {
  const key = customResourceNavigationKey({
    apiVersion: 'cert-manager.io/v1',
    kind: 'Certificate',
    plural: 'certificates',
    namespaced: true,
  })

  assert.deepEqual(customResourceNavigationMetadata(key), {
    key,
    label: 'Certificate',
    group: 'Custom Resources',
  })
  assert.equal(customResourceNavigationMetadata('custom.resources'), null)
})
