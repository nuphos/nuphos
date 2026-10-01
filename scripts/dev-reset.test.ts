import assert from 'node:assert/strict'
import { test } from 'node:test'

import { acquireResetLock, resetInProgress, runReset } from './dev-reset.ts'

const PORT = 48_899

function deps(launchers: { count: number }, onConfirm = () => {}) {
  const wiped: string[] = []

  return {
    wiped,
    deps: {
      confirm: () => {
        onConfirm()

        return Promise.resolve(true)
      },
      acquire: () => Promise.resolve(() => {}),
      otherLaunchers: () => launchers.count,
      wipe: () => {
        wiped.push('down -v')

        return Promise.resolve(true)
      },
    },
  }
}

test('a launcher that starts while the question is open aborts the wipe', async () => {
  const launchers = { count: 0 }
  const { wiped, deps: d } = deps(launchers, () => {
    launchers.count = 1
  })

  assert.deepEqual(await runReset(d), { outcome: 'in-use', others: 1 })
  assert.deepEqual(wiped, [])
})

test('with no other launcher the stack is wiped', async () => {
  const { wiped, deps: d } = deps({ count: 0 })

  assert.deepEqual(await runReset(d), { outcome: 'wiped' })
  assert.deepEqual(wiped, ['down -v'])
})

test('a reset that cannot take the lock never wipes', async () => {
  const { wiped, deps: d } = deps({ count: 0 })

  assert.deepEqual(await runReset({ ...d, acquire: () => Promise.resolve(null) }), {
    outcome: 'busy',
  })
  assert.deepEqual(wiped, [])
})

test('concurrent resets: exactly one holds the lock, and it frees on release', async () => {
  const [a, b] = await Promise.all([acquireResetLock(PORT), acquireResetLock(PORT)])
  const held = [a, b].filter(Boolean)

  assert.equal(held.length, 1)
  assert.equal(await resetInProgress(PORT), true)
  held[0]!()
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(await resetInProgress(PORT), false)
  const again = await acquireResetLock(PORT)

  assert.ok(again)
  again()
})
