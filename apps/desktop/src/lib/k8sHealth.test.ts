import assert from 'node:assert/strict'
import { test } from 'node:test'

import { k8sStatusTone, podTone, readinessTone, replicaTone } from './k8sHealth.ts'

for (const [status, ready, tone] of [
  ['Completed', '0/1', 'neutral'],
  ['Succeeded', '0/2', 'neutral'],
  ['CrashLoopBackOff', '0/1', 'error'],
  ['Init:CrashLoopBackOff', '0/2', 'error'],
  ['OOMKilled', '1/2', 'error'],
  ['Evicted', '0/1', 'error'],
  ['ErrImagePull', '0/1', 'error'],
  ['ImagePullBackOff', '0/1', 'error'],
  ['CreateContainerConfigError', '0/1', 'error'],
  ['InvalidImageName', '0/1', 'error'],
  ['Unschedulable', '0/1', 'error'],
  ['ExitCode:137', '0/1', 'error'],
  ['Pending', '0/1', 'warning'],
  ['ContainerCreating', '0/1', 'warning'],
  ['Init:0/2', '0/1', 'warning'],
  ['Terminating', '1/1', 'warning'],
  ['Running', '0/1', 'error'],
  ['Running', '1/2', 'warning'],
  ['Running', '2/2', 'success'],
  ['NotReady', '1/1', 'error'],
  ['Unknown', '1/1', 'warning'],
  ['CustomReason', '1/1', 'warning'],
]) {
  test(`Pod ${status} ${ready}: ${tone}`, () => assert.equal(podTone(status, ready), tone))
}

test('replica counts distinguish zero, unavailable, partial, healthy and surplus', () => {
  for (const [value, expected] of [
    ['0/0', 'neutral'],
    ['0/3', 'error'],
    ['1/3', 'warning'],
    ['3/3', 'success'],
    ['4/3', 'warning'],
    ['1/0', 'warning'],
    ['-', 'warning'],
  ]) {
    assert.equal(readinessTone(value), expected)
  }
  assert.equal(replicaTone(NaN, 3), 'warning')
  assert.equal(replicaTone(-1, 3), 'warning')
})

test('Job lifecycle distinguishes completion, retries and suspension', () => {
  assert.equal(k8sStatusTone('Complete'), 'neutral')
  assert.equal(k8sStatusTone('Suspended'), 'neutral')
  assert.equal(k8sStatusTone('Completing'), 'warning')
  assert.equal(k8sStatusTone('Retrying'), 'warning')
  assert.equal(k8sStatusTone('Failed'), 'error')
})
