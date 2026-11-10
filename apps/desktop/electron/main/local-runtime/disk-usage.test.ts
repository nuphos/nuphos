import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  SESSION_WORKSPACE_IDLE_MS,
  SESSION_WORKSPACE_MARKER,
  sessionWorkspaceName,
} from './disk-reclaim.ts'
import {
  DISK_MAINTENANCE_DELAY_MS,
  measureDirectory,
  runDiskMaintenance,
  startDiskMaintenance,
} from './disk-usage.ts'

type TestContext = {
  after: (fn: () => void) => void
  skip?: (message?: string) => void
}

function tempRoot(t: TestContext, prefix = 'nuphos-disk-usage-'): string {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix))

  t.after(() => rmSync(root, { recursive: true, force: true }))

  return root
}

/** A file of `bytes` bytes, so a size can be asserted without guessing. */
function file(at: string, bytes: number): void {
  mkdirSync(path.dirname(at), { recursive: true })
  writeFileSync(at, 'x'.repeat(bytes))
}

test('a directory is measured through its subdirectories, and the reading is complete', async (t) => {
  const root = tempRoot(t)

  file(path.join(root, 'one.bin'), 10)
  file(path.join(root, 'nested', 'two.bin'), 32)
  const usage = await measureDirectory(root)

  assert.equal(usage.bytes, 42)
  assert.equal(usage.complete, true)
  assert.ok(usage.entries >= 3)
})

test('a link is not followed, so what it points at is never counted or walked', async (t) => {
  const root = tempRoot(t)
  const outside = tempRoot(t, 'nuphos-disk-outside-')

  file(path.join(root, 'mine.bin'), 5)
  file(path.join(outside, 'theirs.bin'), 4096)
  try {
    symlinkSync(outside, path.join(root, 'link'), 'junction')
  } catch {
    t.skip?.('this machine cannot make a link without administrator rights')

    return
  }
  const usage = await measureDirectory(root)

  assert.equal(usage.bytes, 5)
  assert.equal(usage.complete, true)
})

test('the reading stops at the entry cap, and says it is incomplete', async (t) => {
  const root = tempRoot(t)

  file(path.join(root, 'a.bin'), 1)
  file(path.join(root, 'b.bin'), 1)
  const usage = await measureDirectory(root, { entryCap: 1 })

  assert.equal(usage.complete, false)
  assert.equal(usage.entries, 1)
})

test('the reading stops at the deadline, and says it is incomplete', async (t) => {
  const root = tempRoot(t)

  file(path.join(root, 'a.bin'), 1)
  // A clock that has already passed the deadline stops the walk before it starts.
  const usage = await measureDirectory(root, { deadlineMs: -1, now: () => 0 })

  assert.equal(usage.complete, false)
  assert.equal(usage.entries, 0)
})

test('a directory that is not there reads as nothing, and is not an error', async () => {
  const usage = await measureDirectory(path.join(os.tmpdir(), 'nuphos-measure-that-is-not-there'))

  assert.deepEqual(usage, { bytes: 0, entries: 0, complete: true })
})

test('a finished session workspace is reclaimed, and the workspace is reported', async (t) => {
  const root = tempRoot(t)
  const dir = path.join(root, sessionWorkspaceName('conversation-1'))
  const marker = path.join(dir, SESSION_WORKSPACE_MARKER)
  const at = new Date(Date.now() - SESSION_WORKSPACE_IDLE_MS - 24 * 60 * 60 * 1000)
  const logged: { message: string; data?: Record<string, unknown> }[] = []

  mkdirSync(dir)
  writeFileSync(marker, JSON.stringify({ version: 1, sessionId: 'conversation-1' }))
  utimesSync(marker, at, at)
  utimesSync(dir, at, at)
  await runDiskMaintenance({
    workspaces: () => [root],
    inUse: () => false,
    leftAlone: null,
    log: (message, data) => logged.push({ message, data }),
  })

  assert.equal(existsSync(dir), false)
  assert.deepEqual(logged[0]?.data?.reclaimed, 1)
  assert.equal(logged[0]?.data?.workspace, root)
})

test('the directory this build does not use is reported, and left exactly where it is', async (t) => {
  const leftAlone = tempRoot(t, 'nuphos-disk-left-alone-')

  file(path.join(leftAlone, 'local-runtime', 'workspace', 'old-clone', 'index.js'), 2048)
  const logged: { message: string; data?: Record<string, unknown> }[] = []

  await runDiskMaintenance({
    workspaces: () => [],
    inUse: () => false,
    leftAlone,
    log: (message, data) => logged.push({ message, data }),
  })

  // Reported with its size, never deleted: only its owner can say it is finished with.
  assert.equal(existsSync(path.join(leftAlone, 'local-runtime', 'workspace', 'old-clone')), true)
  assert.deepEqual(logged, [
    {
      message: 'local runtime: unused data directory',
      data: { dir: leftAlone, bytes: 2048, gib: 0, entries: 5, complete: true },
    },
  ])
})

test('a workspace that cannot be read does not stop the pass', async (t) => {
  const logged: string[] = []

  await runDiskMaintenance({
    workspaces: () => [path.join(tempRoot(t), 'not-there')],
    inUse: () => false,
    leftAlone: null,
    log: (message) => logged.push(message),
  })

  assert.deepEqual(logged, ['local runtime: workspace'])
})

test('a workspace list that throws is the caller of the pass to catch, not a process event', async () => {
  await assert.rejects(
    runDiskMaintenance({
      workspaces: () => {
        throw new Error('no state yet')
      },
      inUse: () => false,
      leftAlone: null,
    }),
    /no state yet/u,
  )
})

test('the scheduled pass waits, and can be cancelled before it runs', () => {
  const logged: string[] = []
  const cancel = startDiskMaintenance(
    {
      workspaces: () => [],
      inUse: () => false,
      leftAlone: null,
      log: (message) => logged.push(message),
    },
    DISK_MAINTENANCE_DELAY_MS,
  )

  cancel()

  assert.deepEqual(logged, [])
})
