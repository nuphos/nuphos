import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  closeSessionsOutsideScope,
  createSession,
  detachPodExecSession,
  liveSession,
  replayPodExecSession,
  send,
} from './session.ts'

import type { PodExecEvent } from './session.ts'
import type { WebContents } from 'electron'

function renderer() {
  const sent: PodExecEvent[] = []
  const target = {
    isDestroyed: () => false,
    send: (_channel: string, event: PodExecEvent) => sent.push(event),
  }

  return { target: target as unknown as WebContents, sent }
}

/** A session key as the renderer builds it: tab, then scope, then container. */
function key(tabId: string, scope: string, container = 'app') {
  return [tabId, scope, container].join('\0')
}

test('a session is found again under the id its caller chose', () => {
  const { target } = renderer()
  const id = key('tab-a1', 'pod-a')

  createSession(target, id)
  assert.equal(liveSession(id)?.id, id)
  // A remount asks for the same id rather than opening a second exec.
  assert.equal(liveSession(key('tab-a1', 'pod-a')), liveSession(id))
  assert.equal(liveSession(key('tab-a2', 'pod-a')), null)
  closeSessionsOutsideScope('tab-a1', null)
})

test('an empty or absurd id is refused', () => {
  const { target } = renderer()

  assert.throws(() => createSession(target, ''), /Invalid terminal session id/)
  assert.throws(() => createSession(target, 'x'.repeat(401)), /Invalid terminal session id/)
})

test('teardown ends what a tab left behind and spares what it still has open', () => {
  const { target } = renderer()
  const stillOpen = key('tab-b1', 'pod-a')
  const navigatedAway = key('tab-b1', 'pod-b')
  const otherTab = key('tab-b2', 'pod-b')

  for (const id of [stillOpen, navigatedAway, otherTab]) createSession(target, id)
  closeSessionsOutsideScope('tab-b1', 'pod-a')

  assert.equal(liveSession(stillOpen)?.id, stillOpen)
  assert.equal(liveSession(navigatedAway), null)
  // Another tab's session is never collateral, even on the same pod.
  assert.equal(liveSession(otherTab)?.id, otherTab)
  closeSessionsOutsideScope('tab-b1', null)
  closeSessionsOutsideScope('tab-b2', null)
  assert.equal(liveSession(stillOpen), null)
  assert.equal(liveSession(otherTab), null)
})

test('a second container under the same pod survives teardown of the pod it is in', () => {
  const { target } = renderer()
  const app = key('tab-c1', 'pod-a', 'app')
  const sidecar = key('tab-c1', 'pod-a', 'sidecar')

  createSession(target, app)
  createSession(target, sidecar)
  closeSessionsOutsideScope('tab-c1', 'pod-a')

  assert.equal(liveSession(app)?.id, app)
  assert.equal(liveSession(sidecar)?.id, sidecar)
  closeSessionsOutsideScope('tab-c1', null)
})

test('a tab that navigates back to a pod may open a terminal there again', () => {
  const { target } = renderer()
  const id = key('tab-d1', 'pod-a')

  createSession(target, id)
  // Away…
  closeSessionsOutsideScope('tab-d1', null)
  assert.equal(liveSession(id), null)
  // …and back. The observer records the new scope before the view remounts.
  closeSessionsOutsideScope('tab-d1', 'pod-a')
  assert.equal(createSession(target, id).id, id)
  closeSessionsOutsideScope('tab-d1', null)
})

test('a start that resolves after its tab closed is refused, not left running', () => {
  const { target } = renderer()
  const id = key('tab-9', 'node-a', '')

  // The tab closes while node-exec is still waiting on consent / the pod.
  closeSessionsOutsideScope('tab-9', null)
  assert.throws(() => createSession(target, id), /closed while it was still opening/)

  // Same for a tab that merely navigated to a different pod.
  closeSessionsOutsideScope('tab-9', 'pod-b')
  assert.throws(() => createSession(target, key('tab-9', 'pod-a')), /still opening/)
  const allowed = key('tab-9', 'pod-b')

  assert.equal(createSession(target, allowed).id, allowed)
  closeSessionsOutsideScope('tab-9', null)
})

test('output missed while the view was unmounted is replayed, not lost or doubled', () => {
  const { target, sent } = renderer()
  const id = key('tab-e1', 'pod-a')
  const session = createSession(target, id)

  replayPodExecSession(target, id)
  send(target, session, { id, type: 'data', data: 'before' })
  assert.deepEqual(
    sent.map((e) => (e.type === 'data' ? e.data : e.type)),
    ['before'],
  )

  // The dock swapped chat session: the view unmounted, the session did not.
  detachPodExecSession(id)
  send(target, session, { id, type: 'data', data: 'while-away' })
  assert.equal(sent.length, 1, 'nothing is streamed at a listener that is gone')

  // Back again: the fresh xterm is repainted from the buffer, once.
  sent.length = 0
  replayPodExecSession(target, id)
  assert.deepEqual(
    sent.map((e) => (e.type === 'data' ? e.data : e.type)),
    ['before', 'while-away'],
  )

  sent.length = 0
  send(target, session, { id, type: 'data', data: 'after' })
  assert.deepEqual(
    sent.map((e) => (e.type === 'data' ? e.data : e.type)),
    ['after'],
  )
  closeSessionsOutsideScope('tab-e1', null)
})
