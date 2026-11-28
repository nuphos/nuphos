import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { humanHolds, missingForDesktops } from './desktop-pool.ts'

/** A pool with display :1 locked by `sessionId`, its control file saying `control`. */
function pool(sessionId: string, control?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'desktop-pool-'))

  writeFileSync(join(dir, '1.lock'), JSON.stringify({ sessionId, pid: 1 }))
  if (control !== undefined) {
    mkdirSync(join(dir, '1.xdg'))
    writeFileSync(join(dir, '1.xdg', 'instabox-control'), control)
  }

  return dir
}

const now = 1_000_000_000

test("a person holds a session's desktop while they keep renewing control of it", () => {
  assert.equal(humanHolds(pool('s1', `human Sam ${String(now / 1000 - 10)}\n`), 's1', now), true)
})

test('a lapsed hold, an agent-held desktop or another session is not held', () => {
  assert.equal(humanHolds(pool('s1', `human Sam ${String(now / 1000 - 31)}`), 's1', now), false)
  assert.equal(humanHolds(pool('s1', 'agent'), 's1', now), false)
  assert.equal(humanHolds(pool('s1'), 's1', now), false)
  assert.equal(humanHolds(pool('s2', `human Sam ${String(now / 1000)}`), 's1', now), false)
  assert.equal(humanHolds(join(tmpdir(), 'no-such-pool'), 's1', now), false)
})

// A Linux computer hosts desktops with what it has on PATH, and names what it lacks (#5321).
test('a computer lacking Xvnc, XFCE or the computer-use server is told what to install', () => {
  const bin = mkdtempSync(join(tmpdir(), 'desktop-bin-'))

  assert.deepEqual(missingForDesktops(bin), [
    'tigervnc-standalone-server',
    'xfce4',
    'npm install -g open-computer-use',
  ])
  for (const command of ['Xvnc', 'xfce4-session', 'open-computer-use'])
    writeFileSync(join(bin, command), '')
  assert.deepEqual(missingForDesktops(`${join(tmpdir(), 'no-such-bin')}:${bin}`), [])
})
