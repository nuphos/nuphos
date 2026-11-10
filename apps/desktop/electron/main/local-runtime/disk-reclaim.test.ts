import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  insideRoot,
  planReclaim,
  reclaimSessionWorkspaces,
  SESSION_WORKSPACE_IDLE_MS,
  SESSION_WORKSPACE_MARKER,
  sessionWorkspaceName,
} from './disk-reclaim.ts'

import type { SessionWorkspaceEntry } from './disk-reclaim.ts'

const CONVERSATION = 'conversation-1'
const NAME = sessionWorkspaceName(CONVERSATION)
/** Older than the idle window by a day: finished, whatever the clock says. */
const STALE_MS = SESSION_WORKSPACE_IDLE_MS + 24 * 60 * 60 * 1000

type TestContext = {
  after: (fn: () => void) => void
  skip?: (message?: string) => void
}

/** One entry, with everything that keeps it overridden per test. */
function entry(overrides: Partial<SessionWorkspaceEntry> = {}): SessionWorkspaceEntry {
  return {
    name: NAME,
    path: path.join('workspace', NAME),
    marked: true,
    ageMs: STALE_MS,
    holdsWork: false,
    inUse: false,
    escapesRoot: false,
    ...overrides,
  }
}

function decision(overrides: Partial<SessionWorkspaceEntry> = {}) {
  const [only] = planReclaim([entry(overrides)])

  assert.ok(only)

  return only
}

/** A throwaway workspace root, removed whether or not the test throws. */
function tempRoot(t: TestContext): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nuphos-disk-reclaim-'))

  t.after(() => rmSync(root, { recursive: true, force: true }))

  return root
}

/** A session workspace of ours: the conversation's name, carrying its own marker. */
function sessionWorkspace(root: string, ageMs = STALE_MS, sessionId = CONVERSATION): string {
  const dir = path.join(root, sessionWorkspaceName(sessionId))
  const at = new Date(Date.now() - ageMs)

  mkdirSync(dir)
  writeFileSync(path.join(dir, SESSION_WORKSPACE_MARKER), JSON.stringify({ version: 1, sessionId }))
  utimesSync(path.join(dir, SESSION_WORKSPACE_MARKER), at, at)
  utimesSync(dir, at, at)

  return dir
}

test('a stale, unused, empty session workspace of ours is deleted', () => {
  assert.deepEqual(decision(), {
    name: NAME,
    path: path.join('workspace', NAME),
    delete: true,
    reason: 'stale-session-workspace',
  })
})

test('a session workspace touched inside the idle window is kept', () => {
  assert.equal(decision({ ageMs: SESSION_WORKSPACE_IDLE_MS - 1 }).delete, false)
  assert.equal(decision({ ageMs: 1_000 }).reason, 'too-recent')
})

test('a session workspace a live session is using is kept', () => {
  assert.deepEqual(decision({ inUse: true }), {
    name: NAME,
    path: path.join('workspace', NAME),
    delete: false,
    reason: 'in-use',
  })
})

test('a directory without our marker is kept, whatever else is true of it', () => {
  assert.equal(decision({ marked: false, inUse: false }).reason, 'unmarked')
})

test('a session workspace holding anything but our marker is kept', () => {
  assert.equal(decision({ holdsWork: true }).reason, 'holds-work')
})

test('a session workspace whose age cannot be read is kept', () => {
  assert.equal(decision({ ageMs: null }).reason, 'unknown-age')
})

test('an entry that resolves out of the workspace root is kept', () => {
  // A link or a junction: what it points at is not ours to delete, or to walk into.
  assert.equal(decision({ escapesRoot: true }).reason, 'escapes-root')
})

test('a link is kept even when it is old, empty and unused', () => {
  assert.equal(decision({ escapesRoot: true, ageMs: STALE_MS, inUse: false }).delete, false)
})

test('a path outside the expected parent is rejected', () => {
  const root = path.join('data', 'users', 'one', 'workspace')

  assert.equal(insideRoot(root, path.join(root, NAME)), true)
  assert.equal(insideRoot(root, path.join(root, 'nested', NAME)), false)
  assert.equal(insideRoot(root, path.join('data', 'users', 'two', 'workspace', NAME)), false)
  assert.equal(insideRoot(root, path.join(root, '..', 'other', NAME)), false)
  assert.equal(insideRoot(root, root), false)
  assert.equal(insideRoot(root, path.parse(root).root), false)
})

test('a real directory that does not match our naming is never reclaimed', async (t) => {
  const root = tempRoot(t)
  const mine = sessionWorkspace(root)
  const neighbour = path.join(root, 'my-clone')

  mkdirSync(neighbour)
  writeFileSync(path.join(neighbour, 'work.txt'), 'unpushed')
  const removed = await reclaimSessionWorkspaces(root, { inUse: () => false })

  assert.deepEqual(removed, [mine])
  assert.equal(existsSync(neighbour), true)
})

test('a real session workspace holding a file is kept', async (t) => {
  const root = tempRoot(t)
  const dir = sessionWorkspace(root)

  writeFileSync(path.join(dir, 'notes.md'), 'mine')
  const removed = await reclaimSessionWorkspaces(root, { inUse: () => false })

  assert.deepEqual(removed, [])
  assert.equal(existsSync(dir), true)
})

test('a workspace a live session is using survives the pass', async (t) => {
  const root = tempRoot(t)
  const dir = sessionWorkspace(root)
  const removed = await reclaimSessionWorkspaces(root, { inUse: () => true })

  assert.deepEqual(removed, [])
  assert.equal(existsSync(dir), true)
})

test('nothing is deleted when no one can say whether it is in use', async (t) => {
  const root = tempRoot(t)
  const dir = sessionWorkspace(root)
  const removed = await reclaimSessionWorkspaces(root)

  assert.deepEqual(removed, [])
  assert.equal(existsSync(dir), true)
})

test('a marker for another conversation does not make a directory ours', async (t) => {
  const root = tempRoot(t)
  const dir = path.join(root, NAME)

  mkdirSync(dir)
  writeFileSync(
    path.join(dir, SESSION_WORKSPACE_MARKER),
    JSON.stringify({ version: 1, sessionId: 'someone-else' }),
  )
  const removed = await reclaimSessionWorkspaces(root, { inUse: () => false })

  assert.deepEqual(removed, [])
  assert.equal(existsSync(dir), true)
})

test('a link out of the root is never followed, and never deleted', async (t) => {
  const root = tempRoot(t)
  const outside = tempRoot(t)
  const target = path.join(outside, 'somebody-elses-work')
  const link = path.join(root, NAME)

  mkdirSync(target)
  writeFileSync(path.join(target, 'work.txt'), 'not ours')
  try {
    symlinkSync(target, link, 'junction')
  } catch {
    t.skip?.('this machine cannot make a link without administrator rights')

    return
  }
  const removed = await reclaimSessionWorkspaces(root, { inUse: () => false })

  assert.deepEqual(removed, [])
  assert.equal(existsSync(path.join(target, 'work.txt')), true)
  assert.equal(existsSync(link), true)
})

test('a removal that fails is logged, and the pass carries on', async (t) => {
  const root = tempRoot(t)
  const dir = sessionWorkspace(root)
  const logged: string[] = []

  // The directory goes between the decision and the deletion, which is what a second
  // sweep taking it first looks like. The path is resolved again, so this is caught.
  const removed = await reclaimSessionWorkspaces(root, {
    inUse: () => {
      rmSync(dir, { recursive: true, force: true })

      return false
    },
    log: (message) => logged.push(message),
  })

  assert.deepEqual(removed, [])
  assert.equal(logged.length, 1)
})

test('a directory that gained a file before the delete is kept, and the file survives', async (t) => {
  const root = tempRoot(t)
  const dir = sessionWorkspace(root)
  const marker = path.join(dir, SESSION_WORKSPACE_MARKER)
  const arrived = path.join(dir, 'late.txt')
  const logged: { message: string; data?: Record<string, unknown> }[] = []

  // The probe is the last thing asked before the plan, so this is a file arriving
  // inside the window a recursive delete would have swept up with the marker.
  const removed = await reclaimSessionWorkspaces(root, {
    inUse: () => {
      writeFileSync(arrived, 'a session is writing here')

      return false
    },
    log: (message, data) => logged.push({ message, data }),
  })

  assert.deepEqual(removed, [])
  assert.equal(readFileSync(arrived, 'utf8'), 'a session is writing here')
  // The marker goes back, so the directory is still ours on a later pass.
  assert.equal(existsSync(marker), true)
  assert.deepEqual(logged, [
    {
      message: 'local runtime: a session workspace was kept',
      data: { path: dir, reason: 'gained-content' },
    },
  ])
})

test('a directory holding only the marker is removed completely', async (t) => {
  const root = tempRoot(t)
  const dir = sessionWorkspace(root)
  const removed = await reclaimSessionWorkspaces(root, { inUse: () => false })

  assert.deepEqual(removed, [dir])
  assert.equal(existsSync(dir), false)
})

test('a marker that goes before it can be removed is not an error', async (t) => {
  const root = tempRoot(t)
  const dir = sessionWorkspace(root)
  const logged: string[] = []

  const removed = await reclaimSessionWorkspaces(root, {
    inUse: () => {
      rmSync(path.join(dir, SESSION_WORKSPACE_MARKER))

      return false
    },
    log: (message) => logged.push(message),
  })

  // Nothing was left but an empty directory, so it goes without a word.
  assert.deepEqual(removed, [dir])
  assert.equal(existsSync(dir), false)
  assert.deepEqual(logged, [])
})

test('a marker that cannot be removed is logged, and does not throw', async (t) => {
  const root = tempRoot(t)
  const dir = sessionWorkspace(root)
  const marker = path.join(dir, SESSION_WORKSPACE_MARKER)
  const logged: string[] = []

  const removed = await reclaimSessionWorkspaces(root, {
    inUse: () => {
      // A directory where the marker file was: `unlink` refuses it on every platform.
      rmSync(marker)
      mkdirSync(marker)

      return false
    },
    log: (message) => logged.push(message),
  })

  assert.deepEqual(removed, [])
  assert.equal(existsSync(dir), true)
  assert.deepEqual(logged, ['local runtime: a session workspace was not reclaimed'])
})

test('a workspace root that cannot be read is not an error', async () => {
  const missing = path.join(os.tmpdir(), 'nuphos-workspace-that-is-not-there', NAME)

  assert.deepEqual(await reclaimSessionWorkspaces(missing), [])
})
