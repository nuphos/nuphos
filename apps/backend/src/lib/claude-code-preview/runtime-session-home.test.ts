import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { useRuntimeCatalog } from '@/lib/test/doubles/runtime-catalog'
import { useRuntimeRegistry } from '@/lib/test/doubles/runtime-registry'
import { useSessionExecutionState } from '@/lib/test/doubles/session-execution-state'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import { RECLAIM_SESSION_HOME_PROGRAM, reclaimArchivedSessionHomes } from './runtime-session-home'

// The program reads /proc, which only Linux runtimes have.
describe.skipIf(!existsSync('/proc/self'))('RECLAIM_SESSION_HOME_PROGRAM', () => {
  let root = ''
  const home = (id: string) =>
    join(root, 'home', '.nuphos', 'session-homes', createHash('sha256').update(id).digest('hex'))
  // Runs the program the way the panel job does: `node runner.mjs <dir>`.
  const reclaim = (sessionId: string) => {
    const runDir = mkdtempSync(join(root, 'run-'))

    writeFileSync(join(runDir, 'runner.mjs'), RECLAIM_SESSION_HOME_PROGRAM)
    writeFileSync(join(runDir, 'params.json'), JSON.stringify({ sessionId }))
    const run = Bun.spawnSync([process.execPath, join(runDir, 'runner.mjs'), runDir], {
      env: { HOME: join(root, 'home') },
    })

    expect(run.exitCode).toBe(0)

    const outcome = JSON.parse(run.stdout.toString()) as { result: string; unreadable?: string }

    // A host process the scan cannot read keeps every home; name it.
    if (outcome.unreadable) console.error('unreadable process:', outcome.unreadable)

    return outcome.result
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'reclaim-home-'))
    for (const id of ['archived', 'other']) {
      mkdirSync(join(home(id), '.local', 'bin'), { recursive: true })
      writeFileSync(join(home(id), '.local', 'bin', 'tccli'), '')
    }
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  test('removes only the archived home, keeping a symlink target', () => {
    mkdirSync(join(root, 'outside'))
    writeFileSync(join(root, 'outside', 'kept'), '')
    symlinkSync(join(root, 'outside'), join(home('archived'), 'link'))

    expect(reclaim('archived')).toBe('removed')
    expect(existsSync(home('archived'))).toBe(false)
    expect(existsSync(join(home('other'), '.local', 'bin', 'tccli'))).toBe(true)
    expect(existsSync(join(root, 'outside', 'kept'))).toBe(true)
    expect(reclaim('archived')).toBe('absent')
  })

  test('removes a home that is itself a symlink without following it', () => {
    mkdirSync(join(root, 'target'))
    writeFileSync(join(root, 'target', 'kept'), '')
    rmSync(home('archived'), { recursive: true })
    symlinkSync(join(root, 'target'), home('archived'))

    expect(reclaim('archived')).toBe('removed')
    expect(existsSync(join(root, 'target', 'kept'))).toBe(true)
  })

  test('keeps a home that a running process uses as HOME', () => {
    const shell = Bun.spawn(['sleep', '30'], {
      env: { HOME: home('archived'), PATH: '/bin:/usr/bin' },
    })

    try {
      expect(reclaim('archived')).toBe('in_use')
      expect(existsSync(join(home('archived'), '.local', 'bin', 'tccli'))).toBe(true)
    } finally {
      shell.kill()
    }
  })

  test('keeps a home that a running process works inside, without leaving it set aside', () => {
    const shell = Bun.spawn(['sleep', '30'], { cwd: join(home('archived'), '.local') })

    try {
      expect(reclaim('archived')).toBe('in_use')
      expect(existsSync(join(home('archived'), '.local', 'bin', 'tccli'))).toBe(true)
      expect(
        readdirSync(dirname(home('archived'))).filter((name) => name.includes('.reclaim-')),
      ).toEqual([])
    } finally {
      shell.kill()
    }
  })

  test('ignores an exited process that is not yet reaped', () => {
    const shell = Bun.spawn(['sleep', '30'], {
      env: { HOME: home('archived'), PATH: '/bin:/usr/bin' },
    })

    shell.kill()
    // A zombie's environ is unreadable; it must not count as a user.
    while (!readFileSync(`/proc/${shell.pid}/stat`, 'utf8').includes(') Z ')) Bun.sleepSync(5)

    expect(reclaim('archived')).toBe('removed')
  })

  // A set-aside home left by a run ten minutes ago or earlier.
  const leftover = (id: string, setAt = Date.now() - 11 * 60_000) => {
    const left = `${home(id)}.reclaim-${setAt}-left`

    mkdirSync(join(left, '.local'), { recursive: true })

    return left
  }

  test('removes a set-aside home a killed run of the same conversation left behind', () => {
    const left = leftover('archived')

    expect(reclaim('archived')).toBe('removed')
    expect(existsSync(left)).toBe(false)
  })

  test("keeps another conversation's set-aside home", () => {
    const left = leftover('other')

    expect(reclaim('archived')).toBe('removed')
    expect(existsSync(left)).toBe(true)
  })

  test('keeps a set-aside home a running job may still hold', () => {
    const left = leftover('archived', Date.now())

    expect(reclaim('archived')).toBe('removed')
    expect(existsSync(left)).toBe(true)
  })

  test('keeps a set-aside home still used by its original HOME path', () => {
    const left = leftover('archived')
    const shell = Bun.spawn(['sleep', '30'], {
      env: { HOME: home('archived'), PATH: '/bin:/usr/bin' },
    })

    rmSync(home('archived'), { recursive: true })

    try {
      expect(reclaim('archived')).toBe('absent')
      expect(existsSync(left)).toBe(true)
    } finally {
      shell.kill()
    }
  })

  test('keeps a set-aside home a running process works inside', () => {
    const left = leftover('archived')
    const shell = Bun.spawn(['sleep', '30'], { cwd: join(left, '.local') })

    try {
      expect(reclaim('archived')).toBe('removed')
      expect(existsSync(left)).toBe(true)
    } finally {
      shell.kill()
    }
  })

  test('still reclaims the home when a leftover cannot be removed', () => {
    const left = leftover('archived')

    chmodSync(left, 0o555)

    try {
      expect(reclaim('archived')).toBe('removed')
    } finally {
      chmodSync(left, 0o755)
    }
  })
})

describe('reclaimArchivedSessionHomes', () => {
  const now = new Date('2026-10-13T20:00:00Z')
  const archivedAt = new Date('2026-10-13T19:00:00Z')
  // A computer's own agent is never reached, so it counts as reclaimed at once.
  const LOCAL = 'local_owner_device'
  let memory = portabilityDb()
  let state = 'dormant'
  let onProbe = () => {}

  useDb({ db: () => memory })
  useSessionExecutionState({
    conversationExecutionState: async () => {
      onProbe()

      return { state }
    },
  })
  useRuntimeRegistry({ resolveTeamRuntimeEndpoints: async () => [] })
  useRuntimeCatalog({
    developmentRuntimeEndpoint: () => ({
      url: 'ws://127.0.0.1:1/acp',
      authKey: 'key',
      provider: 'claude-code',
      runtimeId: 'development-claude-code',
    }),
  })
  const conversation = (fields: Record<string, unknown>) => {
    const row: Record<string, unknown> = {
      sessionId: 'conversation',
      userId: 'owner',
      teamId: 'team',
      runtimeId: LOCAL,
      agentRuntime: 'claude-code',
      archivedAt,
      ...fields,
    }

    memory.rows('agent_conversations').push(row)

    return row
  }

  beforeEach(() => {
    memory = portabilityDb()
    state = 'dormant'
    onProbe = () => {}
  })

  test('marks an archive that has nothing to reclaim', async () => {
    const row = conversation({})

    expect(await reclaimArchivedSessionHomes(now)).toBe(1)
    expect(row.sessionHomeReclaimedAt).toEqual(now)
  })

  test('skips one already reclaimed since it was archived', async () => {
    conversation({ sessionHomeReclaimedAt: now })
    expect(await reclaimArchivedSessionHomes(now)).toBe(0)
  })

  test('reclaims again after a later archive', async () => {
    conversation({ sessionHomeReclaimedAt: new Date('2026-10-01T00:00:00Z') })
    expect(await reclaimArchivedSessionHomes(now)).toBe(1)
  })

  test('retries while the runtime still runs the session', async () => {
    state = 'idle'
    const row = conversation({ runtimeId: 'development-claude-code' })

    expect(await reclaimArchivedSessionHomes(now)).toBe(0)
    expect(row.sessionHomeReclaimedAt).toBeUndefined()
  })

  test('retries while the runtime cannot be resolved', async () => {
    const row = conversation({ runtimeId: 'gone' })

    expect(await reclaimArchivedSessionHomes(now)).toBe(0)
    expect(row.sessionHomeReclaimedAt).toBeUndefined()
  })

  test('keeps the home of a conversation restored while the sweep ran', async () => {
    state = 'idle'
    conversation({ sessionId: 'first', runtimeId: 'development-claude-code' })
    const restored = conversation({ sessionId: 'second' })

    onProbe = () => {
      delete restored.archivedAt
    }
    expect(await reclaimArchivedSessionHomes(now)).toBe(0)
    expect(restored.sessionHomeReclaimedAt).toBeUndefined()
  })

  test('ignores conversations that are not archived', async () => {
    conversation({ archivedAt: undefined })
    expect(await reclaimArchivedSessionHomes(now)).toBe(0)
  })
})
