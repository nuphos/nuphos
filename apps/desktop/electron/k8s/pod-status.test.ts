import assert from 'node:assert/strict'
import { test } from 'node:test'

import { jobPhase } from './job-status.ts'
import { podStatusSummary, containerStatusText } from './pod-status.ts'

import type { V1Pod, V1ContainerStatus } from '@kubernetes/client-node'

const container = (
  name: string,
  state: V1ContainerStatus['state'],
  ready = false,
): V1ContainerStatus => ({ name, state, ready, restartCount: 0, image: 'test', imageID: 'test' })

function pod(containers: V1ContainerStatus[]): V1Pod {
  return {
    spec: { containers: containers.map((c) => ({ name: c.name })) },
    status: { phase: 'Running', containerStatuses: containers },
  }
}
const completed = container('done', { terminated: { exitCode: 0, reason: 'Completed' } })
const running = container('app', { running: {} }, true)
const crash = container('broken', { waiting: { reason: 'CrashLoopBackOff' } })

test('completion cannot conceal a failure in another container, independent of ordering', () => {
  for (const cs of [
    [completed, crash],
    [crash, completed],
  ]) {
    assert.deepEqual(podStatusSummary(pod(cs)), { status: 'CrashLoopBackOff', ready: '0/2' })
  }
  assert.deepEqual(podStatusSummary(pod([completed, running])), { status: 'Running', ready: '1/2' })
})
test('terminal Pod phase and eviction reason take precedence', () => {
  const p = pod([completed])

  p.status!.phase = 'Succeeded'
  assert.equal(podStatusSummary(p).status, 'Completed')
  p.status = { ...p.status, phase: 'Failed', reason: 'Evicted' }
  assert.equal(podStatusSummary(p).status, 'Evicted')
})
test('init progress, init failure, completed init, and native sidecar readiness', () => {
  const p = pod([running])

  p.spec!.initContainers = [{ name: 'init' }]
  assert.equal(podStatusSummary(p).status, 'Init:0/1')
  p.status!.initContainerStatuses = [{ ...crash, name: 'init' }]
  assert.equal(podStatusSummary(p).status, 'Init:CrashLoopBackOff')
  p.status!.initContainerStatuses = [{ ...completed, name: 'init' }]
  assert.deepEqual(podStatusSummary(p), { status: 'Running', ready: '1/1' })
  p.spec!.initContainers[0].restartPolicy = 'Always'
  p.status!.initContainerStatuses = [{ ...running, name: 'init', started: true, ready: false }]
  assert.deepEqual(podStatusSummary(p), { status: 'Running', ready: '1/2' })
})
test('readiness gates and deletion override a healthy-looking phase', () => {
  const p = pod([running])

  p.status!.conditions = [{ type: 'Ready', status: 'False' }]
  assert.equal(podStatusSummary(p).status, 'NotReady')
  p.metadata = { deletionTimestamp: new Date() }
  assert.equal(podStatusSummary(p).status, 'Terminating')
})
test('historical crashes do not override current healthy state', () => {
  const p = pod([{ ...running, lastState: { terminated: { exitCode: 137, reason: 'OOMKilled' } } }])

  assert.equal(podStatusSummary(p).status, 'Running')
})
test('container exits without a reason remain actionable', () => {
  assert.equal(
    containerStatusText(container('a', { terminated: { exitCode: 137 } })),
    'ExitCode:137',
  )
  assert.equal(containerStatusText(container('a', { terminated: { exitCode: 0 } })), 'Completed')
})
test('Job failed attempts are retries until the controller declares terminal failure', () => {
  assert.equal(jobPhase({ status: { active: 1, failed: 2 } }), 'Retrying')
  assert.equal(jobPhase({ status: { conditions: [{ type: 'Failed', status: 'True' }] } }), 'Failed')
  assert.equal(
    jobPhase({ status: { conditions: [{ type: 'Complete', status: 'True' }] } }),
    'Complete',
  )
  assert.equal(jobPhase({ spec: { template: {}, suspend: true } }), 'Suspended')
  assert.equal(jobPhase({ status: { active: 1 } }), 'Running')
})

test('unschedulable pods are not disguised as normal init progress', () => {
  const p = pod([])

  p.spec!.initContainers = [{ name: 'init' }]
  p.status = {
    phase: 'Pending',
    conditions: [{ type: 'PodScheduled', status: 'False', reason: 'Unschedulable' }],
  }
  assert.equal(podStatusSummary(p).status, 'Unschedulable')
})

test('custom terminal failure reasons retain failure severity', () => {
  const p = pod([])

  p.status = { phase: 'Failed', reason: 'CustomAdmissionReason' }
  assert.equal(podStatusSummary(p).status, 'Failed:CustomAdmissionReason')
})
