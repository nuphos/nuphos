import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classifyProbe,
  isForbiddenK8sError,
  isUnreachableK8sError,
  parseForbiddenSubject,
} from './clusterAccessError.ts'

test('recognises the k8s 403 shapes', () => {
  assert.ok(
    isForbiddenK8sError('nodes is forbidden: User "1000012345" cannot list resource "nodes"'),
  )
  assert.ok(isForbiddenK8sError('{"kind":"Status","reason":"Forbidden","code":403}'))
  assert.ok(isForbiddenK8sError('HTTP-Code: 403'))
  assert.ok(!isForbiddenK8sError('connect ECONNREFUSED 10.0.0.1:443'))
})

test('extracts the denied identity from a 403 body', () => {
  assert.equal(
    parseForbiddenSubject('nodes is forbidden: User "1000012345" cannot list resource "nodes"'),
    '1000012345',
  )
  // Escaped quotes survive the trip through IPC-serialised JSON bodies.
  assert.equal(parseForbiddenSubject('User \\"qcs-role\\" cannot list'), 'qcs-role')
  assert.equal(parseForbiddenSubject('nodes is forbidden'), null)
})

test('recognises "never reached the API server" as unreachable, not denied', () => {
  // What the main process's request deadline produces once it crosses IPC.
  const timeout =
    'Error: The Kubernetes API did not respond within 30s — the cluster endpoint may be unreachable from this machine.'

  assert.ok(isUnreachableK8sError(timeout))
  assert.ok(!isForbiddenK8sError(timeout))

  for (const code of ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET']) {
    assert.ok(
      isUnreachableK8sError(
        `request to https://cls-x.ccs.tencent-cloud.com failed, reason: ${code}`,
      ),
      code,
    )
  }
})

test('a 403 is never classified as unreachable', () => {
  const forbidden = 'pods is forbidden: User "1000012345" cannot list resource "pods"'

  assert.ok(!isUnreachableK8sError(forbidden))
})

test('classifies a probe result into the mask to show', () => {
  const forbidden = 'pods is forbidden: User "1000012345" cannot list resource "pods"'
  const timeout = 'The Kubernetes API did not respond within 300s'

  assert.deepEqual(classifyProbe(true, []), { state: 'ok' })
  assert.deepEqual(classifyProbe(false, [forbidden, forbidden, forbidden]), { state: 'ok' })
  assert.deepEqual(classifyProbe(false, [timeout, timeout, timeout]), { state: 'unreachable' })
})

test('a mixed error set falls back to ok so views show their own errors', () => {
  // This fallback is why the watchdog verdict must be terminal: applied late it
  // would turn an accurate "unreachable" into empty, working-looking views.
  const verdict = classifyProbe(false, [
    'pods is forbidden: User "x" cannot list resource "pods"',
    'The Kubernetes API did not respond within 300s',
  ])

  assert.deepEqual(verdict, { state: 'ok' })
})

test('an empty error set is never reported as denied or unreachable', () => {
  assert.deepEqual(classifyProbe(false, []), { state: 'ok' })
})
