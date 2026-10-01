import assert from 'node:assert/strict'
import { test } from 'node:test'

import { partitionLaunchers } from './dev-launchers.ts'
import { OPEN_MENU, menuKey, quitPlan, quitSummary, treesToStop } from './dev-quit.ts'

import type { QuitMenu } from './dev-quit.ts'

function press(keys: string[], menu: QuitMenu = OPEN_MENU) {
  let state: ReturnType<typeof menuKey> = { menu, quit: null }

  for (const key of keys) {
    if (!state.menu || state.quit) break
    state = menuKey(state.menu, key)
  }

  return state
}

test('Enter on the highlighted first option keeps the stack', () => {
  assert.equal(press(['\r']).quit, 'processes')
})

test('arrows move within the options and stop at the ends', () => {
  assert.equal(press(['\x1b[B', '\r']).quit, 'stop-stack')
  assert.equal(press(['\x1b[A', '\x1b[A', '\r']).quit, 'processes')
  assert.equal(press(['\x1b[B', '\x1b[B', '\x1b[B']).menu?.index, 2)
})

test('Esc or q closes the menu without quitting', () => {
  assert.deepEqual(press(['\x1b']), { menu: null, quit: null })
  assert.deepEqual(press(['\x1b[B', 'q']), { menu: null, quit: null })
})

test('wiping asks again: Enter or y confirms, Esc backs out', () => {
  const armed = press(['\x1b[B', '\x1b[B', '\r'])

  assert.deepEqual(armed, { menu: { index: 2, confirming: true }, quit: null })
  assert.equal(press(['\r'], armed.menu!).quit, 'wipe-stack')
  assert.equal(press(['y'], armed.menu!).quit, 'wipe-stack')
  assert.deepEqual(press(['\x1b'], armed.menu!).menu, { index: 2, confirming: false })
})

test('the stack is stopped or wiped only when no other launcher uses it', () => {
  const alone = { otherLaunchers: 0, tunnel: 'none' as const }
  const shared = { otherLaunchers: 2, tunnel: 'none' as const }

  assert.equal(quitPlan('processes', alone).compose, 'keep')
  assert.equal(quitPlan('stop-stack', alone).compose, 'stop')
  assert.equal(quitPlan('wipe-stack', alone).compose, 'down')
  assert.deepEqual(quitPlan('wipe-stack', shared), {
    compose: 'keep',
    composeHeldBy: 2,
    killTunnel: false,
  })
})

test('a tunnel is stopped only when this launcher started it and nobody else needs it', () => {
  assert.equal(quitPlan('processes', { otherLaunchers: 1, tunnel: 'quick' }).killTunnel, true)
  assert.equal(quitPlan('processes', { otherLaunchers: 0, tunnel: 'named-ours' }).killTunnel, true)
  assert.equal(quitPlan('processes', { otherLaunchers: 1, tunnel: 'named-ours' }).killTunnel, false)
  assert.equal(
    quitPlan('wipe-stack', { otherLaunchers: 0, tunnel: 'named-theirs' }).killTunnel,
    false,
  )
})

test('every tree that was started is stopped, even when its leader already exited', () => {
  assert.deepEqual(
    treesToStop([
      { name: 'stack', pid: undefined },
      { name: 'runtime', pid: 11 },
      { name: 'backend', pid: 12 },
      { name: 'desktop', pid: 13 },
    ]),
    ['runtime', 'backend', 'desktop'],
  )
})

test('other launchers are the live pids besides this one; dead ones are pruned', () => {
  assert.deepEqual(
    partitionLaunchers(['10', '11', '12', 'junk'], 10, (pid) => pid === 11),
    { others: [11], stale: [12] },
  )
})

test('the summary names what is left running and how to stop it', () => {
  const facts = { otherLaunchers: 1, tunnel: 'named-ours' as const }
  const lines = quitSummary(['backend', 'desktop'], quitPlan('stop-stack', facts), facts)

  assert.deepEqual(lines, [
    'stopped: backend, desktop',
    'still running: local stack (1 other launcher(s) still use it) — stop with: bun run dev:stop',
    "still running: named tunnel (other launchers use it) — stop with: pkill -f 'cloudflared tunnel --config'",
  ])
})
