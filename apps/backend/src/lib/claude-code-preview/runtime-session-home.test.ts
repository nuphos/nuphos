import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { useRuntimeRegistry } from '@/lib/test/doubles/runtime-registry'
import { useSessionExecutionState } from '@/lib/test/doubles/session-execution-state'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import { RECLAIM_SESSION_HOME_PROGRAM, reclaimArchivedSessionHomes } from './runtime-session-home'

describe('RECLAIM_SESSION_HOME_PROGRAM', () => {
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

    return (JSON.parse(run.stdout.toString()) as { result: string }).result
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
})

describe('reclaimArchivedSessionHomes', () => {
  const now = new Date('2026-10-13T20:00:00Z')
  const archivedAt = new Date('2026-10-13T19:00:00Z')
  let memory = portabilityDb()
  let state = 'dormant'
  let lookups = 0

  useDb({ db: () => memory })
  useSessionExecutionState({ conversationExecutionState: async () => ({ state }) })
  // The runtime answers nothing, so a reached runtime counts as already gone.
  useRuntimeRegistry({
    resolveTeamRuntimeEndpoints: async () => {
      lookups += 1

      return []
    },
  })
  const conversation = (fields: Record<string, unknown>) =>
    memory.rows('agent_conversations').push({
      sessionId: 'conversation',
      userId: 'owner',
      teamId: 'team',
      runtimeId: 'runtime',
      agentRuntime: 'claude-code',
      archivedAt,
      ...fields,
    })

  beforeEach(() => {
    memory = portabilityDb()
    state = 'dormant'
    lookups = 0
  })

  test('marks an archived conversation once its runtime is gone', async () => {
    conversation({})
    expect(await reclaimArchivedSessionHomes(now)).toBe(1)
    expect(memory.rows('agent_conversations')[0]!.sessionHomeReclaimedAt).toEqual(now)
  })

  test('skips one already reclaimed since it was archived', async () => {
    conversation({ sessionHomeReclaimedAt: now })
    expect(await reclaimArchivedSessionHomes(now)).toBe(0)
    expect(lookups).toBe(0)
  })

  test('retries one archived again after an earlier reclaim', async () => {
    conversation({ sessionHomeReclaimedAt: new Date('2026-10-01T00:00:00Z') })
    expect(await reclaimArchivedSessionHomes(now)).toBe(1)
  })

  test('ignores conversations that are not archived', async () => {
    conversation({ archivedAt: undefined })
    expect(await reclaimArchivedSessionHomes(now)).toBe(0)
    expect(lookups).toBe(0)
  })
})
