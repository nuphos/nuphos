import assert from 'node:assert/strict'
import test from 'node:test'

import { parseWorkloadSummary } from './workload-summary.ts'

test('keeps desired, ready, available, and updated replica counts distinct', () => {
  const summary = parseWorkloadSummary(
    `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: prod
  generation: 8
spec:
  replicas: 4
  strategy: { type: RollingUpdate }
  template:
    spec:
      containers: [{ name: api, image: example/api:v8 }]
status:
  observedGeneration: 8
  readyReplicas: 2
  availableReplicas: 3
  updatedReplicas: 1
`,
    { kind: 'Deployment', namespace: 'prod', name: 'api' },
  )

  assert.equal(summary.desired, 4)
  assert.equal(summary.ready, 2)
  assert.equal(summary.available, 3)
  assert.equal(summary.updated, 1)
})

test('condition tones understand positive and negative Kubernetes conditions', () => {
  const summary = parseWorkloadSummary(
    `
apiVersion: apps/v1
kind: Deployment
metadata: { name: api, namespace: prod }
spec:
  replicas: 1
  template:
    spec:
      containers: [{ name: api, image: example/api:v1 }]
status:
  conditions:
    - { type: Available, status: "False", reason: MinimumReplicasUnavailable }
    - { type: Progressing, status: "True", reason: NewReplicaSetAvailable }
    - { type: ReplicaFailure, status: "False", reason: NoFailure }
`,
    { kind: 'Deployment', namespace: 'prod', name: 'api' },
  )

  assert.deepEqual(
    summary.conditions.map(({ label, tone }) => [label, tone]),
    [
      ['Available: False', 'error'],
      ['Progressing: True', 'success'],
      ['ReplicaFailure: False', 'neutral'],
    ],
  )
})

test('keeps ReplicaSet current replicas distinct from ready replicas', () => {
  const summary = parseWorkloadSummary(
    'kind: ReplicaSet\nspec: { replicas: 3 }\nstatus: { replicas: 3, readyReplicas: 1 }',
    { kind: 'ReplicaSet', namespace: 'prod', name: 'api' },
  )

  assert.equal(summary.updated, 3)
  assert.equal(summary.ready, 1)
})

test('uses controller revisions and never presents resourceVersion as a revision', () => {
  const summary = parseWorkloadSummary(
    `kind: Deployment
metadata:
  resourceVersion: "987654"
  annotations: { deployment.kubernetes.io/revision: "7" }
spec: { replicas: 1 }
`,
    { kind: 'Deployment', namespace: 'prod', name: 'api' },
  )

  assert.equal(summary.revision, '7')
})

test('derives Job state from terminal and controller conditions', () => {
  const target = { kind: 'Job' as const, namespace: 'prod', name: 'task' }
  const state = (spec: string, status: string) =>
    parseWorkloadSummary(`kind: Job\nspec: ${spec}\nstatus: ${status}`, target).jobState

  assert.equal(state('{ completions: 1 }', '{ active: 1 }'), 'running')
  assert.equal(state('{ completions: 1, suspend: true }', '{}'), 'suspended')
  assert.equal(
    state(
      '{ completions: 1 }',
      '{ succeeded: 1, failed: 1, conditions: [{ type: Complete, status: "True" }] }',
    ),
    'complete',
  )
  assert.equal(
    state('{ completions: 1 }', '{ conditions: [{ type: Failed, status: "True" }] }'),
    'failed',
  )
})
