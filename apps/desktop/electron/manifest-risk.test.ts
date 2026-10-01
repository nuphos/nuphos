import assert from 'node:assert/strict'
import { test } from 'node:test'

import { dangerousManifestReason } from './manifest-risk.ts'

// Run with: node --test electron/manifest-risk.test.ts  (Node >= 22.6, strips types)
//
// Assertions check BEHAVIOR only — dangerous → a reason is returned (consent
// fires), benign → null. They deliberately do NOT assert the wording of the
// reason, so rewording a message never fails CI; only an actual change in what
// gets flagged does.

function y(obj: unknown): string {
  return JSON.stringify(obj) // YAML is a JSON superset; js-yaml parses this.
}

// Asserts the manifest is flagged dangerous (non-null reason).
function flagged(obj: unknown): void {
  assert.ok(dangerousManifestReason(y(obj)), `expected dangerous: ${y(obj)}`)
}

test('RBAC kinds are dangerous', () => {
  for (const kind of ['ClusterRole', 'ClusterRoleBinding', 'Role', 'RoleBinding']) {
    flagged({ kind })
  }
})

test('bare Pod: privileged container', () => {
  flagged({
    kind: 'Pod',
    spec: { containers: [{ name: 'c', securityContext: { privileged: true } }] },
  })
})

test('bare Pod: host namespace', () => {
  flagged({ kind: 'Pod', spec: { hostPID: true, containers: [] } })
})

test('bare Pod: hostPath volume', () => {
  flagged({
    kind: 'Pod',
    spec: { containers: [], volumes: [{ name: 'v', hostPath: { path: '/' } }] },
  })
})

test('Deployment: privileged in template', () => {
  flagged({
    kind: 'Deployment',
    spec: { template: { spec: { containers: [{ securityContext: { privileged: true } }] } } },
  })
})

test('initContainer / ephemeralContainer privileged', () => {
  flagged({ kind: 'Pod', spec: { initContainers: [{ securityContext: { privileged: true } }] } })
  flagged({
    kind: 'Pod',
    spec: { ephemeralContainers: [{ securityContext: { privileged: true } }] },
  })
})

// The bug Codex caught: CronJob nests the PodSpec one level deeper.
test('CronJob: privileged in jobTemplate is detected', () => {
  flagged({
    kind: 'CronJob',
    spec: {
      jobTemplate: {
        spec: { template: { spec: { containers: [{ securityContext: { privileged: true } }] } } },
      },
    },
  })
})

test('CronJob: hostPID in jobTemplate is detected', () => {
  flagged({
    kind: 'CronJob',
    spec: { jobTemplate: { spec: { template: { spec: { hostPID: true, containers: [] } } } } },
  })
})

test('benign manifests are not dangerous', () => {
  assert.equal(dangerousManifestReason(y({ kind: 'ConfigMap', data: { a: 'b' } })), null)
  assert.equal(
    dangerousManifestReason(y({ kind: 'Pod', spec: { containers: [{ name: 'app' }] } })),
    null,
  )
  assert.equal(
    dangerousManifestReason(
      y({ kind: 'Deployment', spec: { template: { spec: { containers: [{ name: 'app' }] } } } }),
    ),
    null,
  )
  assert.equal(
    dangerousManifestReason(
      y({
        kind: 'CronJob',
        spec: { jobTemplate: { spec: { template: { spec: { containers: [{ name: 'app' }] } } } } },
      }),
    ),
    null,
  )
})

test('garbage input returns null (gate stays permissive, apply validates)', () => {
  assert.equal(dangerousManifestReason(': : not yaml :'), null)
  assert.equal(dangerousManifestReason('null'), null)
  assert.equal(dangerousManifestReason('[1,2,3]'), null)
  assert.equal(dangerousManifestReason(''), null)
})
