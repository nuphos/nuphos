import assert from 'node:assert/strict'
import test from 'node:test'

import { DesktopRefusal, keepDesktopConnected } from './desktopConnection.ts'

import type { DesktopPhase } from './desktopConnection.ts'

// Run with: cd apps/desktop && node --experimental-strip-types --test src/lib/desktopConnection.test.ts

/** Timers that run when told, and a clock that moves when told. */
function fakeTimers() {
  let now = 0
  const pending: { run: () => void; at: number }[] = []

  return {
    timers: {
      set: (run: () => void, ms: number) => pending.push({ run, at: now + ms }),
      clear: () => {
        pending.length = 0
      },
      now: () => now,
    },
    advance: (ms: number) => {
      now += ms
    },
    /** Runs the next scheduled reconnect; false when none is waiting. */
    fire: () => {
      const next = pending.shift()

      next?.run()

      return Boolean(next)
    },
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/** A desktop whose connections the test opens and drops. */
function harness(mint: () => Promise<string>) {
  const clock = fakeTimers()
  const phases: DesktopPhase['kind'][] = []
  const links: string[] = []
  let events: { opened: () => void; closed: () => void } | undefined
  let detached = 0
  const connection = keepDesktopConnected({
    mint,
    attach: (link, on) => {
      links.push(link)
      events = on

      return () => {
        detached++
      }
    },
    onPhase: (phase) => phases.push(phase.kind),
    timers: clock.timers,
  })

  return {
    ...clock,
    connection,
    phases,
    links,
    detached: () => detached,
    open: () => events?.opened(),
    drop: () => events?.closed(),
  }
}

test('an expired link is never reused: every reconnect mints a new one', async () => {
  let minted = 0
  const desktop = harness(async () => `link-${String(++minted)}`)

  await settle()
  desktop.open()
  desktop.advance(60_000)
  // The viewer's link has expired and its page says so: the view drops it.
  desktop.drop()
  await settle()
  assert.equal(desktop.detached(), 1)
  assert.ok(desktop.fire())
  await settle()
  desktop.open()
  assert.deepEqual(desktop.links, ['link-1', 'link-2'])
  assert.deepEqual(desktop.phases, ['connecting', 'connected', 'reconnecting', 'connected'])
})

test('a dropped socket reconnects with backoff, and a stable connection resets it', async () => {
  const desktop = harness(async () => 'link')

  await settle()
  for (let i = 0; i < 3; i++) {
    desktop.drop()
    assert.ok(desktop.fire())
    await settle()
  }
  assert.equal(desktop.links.length, 4)
  desktop.open()
  desktop.advance(30_000)
  desktop.drop()
  assert.equal(desktop.phases.at(-1), 'reconnecting')
})

test('the backend refusing the desktop stops without retrying', async () => {
  const desktop = harness(async () => {
    throw new DesktopRefusal('offline', 'Box is offline.')
  })

  await settle()
  assert.deepEqual(desktop.phases, ['connecting', 'stopped'])
  assert.equal(desktop.fire(), false)
  assert.equal(desktop.links.length, 0)
})

test('a desktop that never answers stops after a few tries instead of looping', async () => {
  const desktop = harness(async () => {
    throw new Error('network down')
  })

  await settle()
  while (desktop.fire()) await settle()
  assert.equal(desktop.phases.at(-1), 'stopped')
  assert.equal(desktop.phases.filter((phase) => phase === 'reconnecting').length, 6)
  // Trying again starts over.
  desktop.connection.restart()
  assert.equal(desktop.phases.at(-1), 'connecting')
})
