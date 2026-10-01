import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createDeepLinkDelivery, DEEP_LINK_EXPIRY_MS } from './deep-link-delivery.ts'

import type { DeepLinkEnvelope, DeepLinkTarget } from './deep-link-delivery.ts'

// Run with: pnpm test
// (node --experimental-strip-types --experimental-test-module-mocks --test ...)
//
// Cover for deep links that open the app but never navigate. Gating delivery on
// main's own idea of whether a renderer is listening loses the payload whenever
// that idea is wrong — a second window loading, a remount, a logout/login — and
// there is nothing to recover it. Only the renderer's ack ends a delivery here.

type Sent = { channel: string; envelope: DeepLinkEnvelope }

/** A window stand-in whose renderer only acks once `listening` is turned on. */
function fakeTarget(acks: (id: number) => void) {
  const sent: Sent[] = []
  const state = { listening: false, loading: false }
  const target: DeepLinkTarget = {
    isLoading: () => state.loading,
    send: (channel, envelope) => {
      sent.push({ channel, envelope })
      if (state.listening) acks(envelope.deliveryId)
    },
  }

  return { target, sent, state }
}

test('stops resending once the renderer acks', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const delivery = createDeepLinkDelivery(() => fake.target)
  const fake = fakeTarget((id) => delivery.ack(id))

  fake.state.listening = true
  delivery.enqueue('deep-link:app-open', { path: '/teams/t/plans' })
  assert.equal(fake.sent.length, 1)
  assert.equal(delivery.pendingCount(), 0)
  t.mock.timers.tick(60_000)
  assert.equal(fake.sent.length, 1)
})

test('keeps retrying until a listener is attached, then delivers exactly once', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const delivery = createDeepLinkDelivery(() => fake.target)
  const fake = fakeTarget((id) => delivery.ack(id))

  // The renderer is up but has not attached its deep-link listener yet — the
  // exact state the old readiness flag mistook for "gone forever".
  delivery.enqueue('deep-link:app-open', { path: '/teams/t/agent/s1' })
  t.mock.timers.tick(30_000)
  assert.ok(fake.sent.length > 1, 'unacked payloads must be retried')
  assert.equal(delivery.pendingCount(), 1)

  fake.state.listening = true
  t.mock.timers.tick(30_000)
  assert.equal(delivery.pendingCount(), 0)
  assert.deepEqual(fake.sent.at(-1)?.envelope.payload, { path: '/teams/t/agent/s1' })
  assert.equal(new Set(fake.sent.map(({ envelope }) => envelope.deliveryId)).size, 1)
})

test('holds the payload while the window is still loading', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const delivery = createDeepLinkDelivery(() => fake.target)
  const fake = fakeTarget((id) => delivery.ack(id))

  fake.state.loading = true
  fake.state.listening = true
  delivery.enqueue('deep-link:app-open', { path: '/teams/t/plans' })
  assert.equal(fake.sent.length, 0)
  t.mock.timers.tick(5_000)
  assert.equal(fake.sent.length, 0)

  fake.state.loading = false
  t.mock.timers.tick(30_000)
  assert.equal(delivery.pendingCount(), 0)
})

test('holds the payload while no window exists yet', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const fake = fakeTarget((id) => delivery.ack(id))
  const windowOpen = { value: false }
  const delivery = createDeepLinkDelivery(() => (windowOpen.value ? fake.target : null))

  fake.state.listening = true
  delivery.enqueue('deep-link:agent-chat', { prompt: 'hi' })
  t.mock.timers.tick(10_000)
  assert.equal(fake.sent.length, 0)
  assert.equal(delivery.pendingCount(), 1)

  windowOpen.value = true
  t.mock.timers.tick(30_000)
  assert.equal(delivery.pendingCount(), 0)
})

test('flush delivers to the window it is handed, not the fallback', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const fallback = fakeTarget((id) => delivery.ack(id))
  const preferred = fakeTarget((id) => delivery.ack(id))
  const delivery = createDeepLinkDelivery(() => fallback.target)

  preferred.state.listening = true
  delivery.enqueue('deep-link:app-open', { path: '/teams/t/plans' }, preferred.target)
  assert.equal(preferred.sent.length, 1)
  assert.equal(fallback.sent.length, 0)
})

test('drops a payload nobody ever collected instead of retrying forever', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const delivery = createDeepLinkDelivery(() => fake.target)
  const fake = fakeTarget((id) => delivery.ack(id))

  delivery.enqueue('deep-link:app-open', { path: '/teams/t/plans' })
  t.mock.timers.tick(DEEP_LINK_EXPIRY_MS + 60_000)
  assert.equal(delivery.pendingCount(), 0)
  const sentBefore = fake.sent.length

  fake.state.listening = true
  t.mock.timers.tick(60_000)
  assert.equal(fake.sent.length, sentBefore)
})
