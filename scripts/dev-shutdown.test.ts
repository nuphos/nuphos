import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { test } from 'node:test'

import { stopTree, waitExit } from './dev-shutdown.ts'

// Run with: node --test --experimental-strip-types scripts/dev-shutdown.test.ts

function groupHasMembers(pgid: number): boolean {
  try {
    process.kill(-pgid, 0)

    return true
  } catch {
    return false
  }
}

// `pnpm electron:dev` is the group leader and exits ahead of vite/Electron. A
// teardown that only waits for the leader leaves Electron running with a
// closed stdout — the "write EPIPE" crash dialog.
test('stopTree reaps descendants that outlive the group leader', async () => {
  const child = spawn('sh', ['-c', 'sleep 60 & exit 0'], {
    detached: true,
    stdio: 'ignore',
  })
  const pgid = child.pid!

  await waitExit(child, 5_000)
  assert.notEqual(child.exitCode, null, 'leader exits on its own')
  assert.equal(groupHasMembers(pgid), true, 'the backgrounded sleep survives the leader')

  const how = await stopTree(child, 1_000)

  assert.equal(groupHasMembers(pgid), false, 'nothing is left in the group')
  assert.equal(how, 'stopped')
})

test('stopTree force-kills a tree that ignores SIGTERM', async () => {
  const child = spawn('sh', ['-c', "trap '' TERM; sleep 60"], {
    detached: true,
    stdio: 'ignore',
  })
  const pgid = child.pid!

  await new Promise((r) => setTimeout(r, 200))
  const how = await stopTree(child, 300)

  assert.equal(how, 'force-killed')
  assert.equal(groupHasMembers(pgid), false)
})

test('stopTree is a no-op without a process', async () => {
  assert.equal(await stopTree(null), 'stopped')
})
