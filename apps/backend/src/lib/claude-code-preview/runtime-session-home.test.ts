import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, test } from 'bun:test'

import { useAgentRunStore } from '@/lib/test/doubles/agent-run-store'
import { useDb } from '@/lib/test/doubles/db'
import { useRedis } from '@/lib/test/doubles/redis'
import { useRuntimeRegistry } from '@/lib/test/doubles/runtime-registry'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import { FORGET_SESSION_HOME_PROGRAM, forgetRuntimeSessionHome } from './runtime-session-home'

describe('FORGET_SESSION_HOME_PROGRAM', () => {
  test('empties only the archived conversation home, as the panel job runs it', () => {
    const root = mkdtempSync(join(tmpdir(), 'forget-home-'))

    try {
      const homes = join(root, 'home', '.nuphos', 'session-homes')
      const home = (id: string) => join(homes, createHash('sha256').update(id).digest('hex'))
      const outside = join(root, 'outside')

      for (const id of ['archived', 'other']) {
        mkdirSync(join(home(id), '.local', 'bin'), { recursive: true })
        writeFileSync(join(home(id), '.local', 'bin', 'tccli'), '')
      }
      mkdirSync(outside)
      writeFileSync(join(outside, 'kept'), '')
      symlinkSync(outside, join(home('archived'), 'link'))
      const runDir = join(root, 'run')

      mkdirSync(runDir)
      writeFileSync(join(runDir, 'runner.mjs'), FORGET_SESSION_HOME_PROGRAM)
      writeFileSync(join(runDir, 'params.json'), JSON.stringify({ sessionId: 'archived' }))
      const run = Bun.spawnSync([process.execPath, join(runDir, 'runner.mjs'), runDir], {
        env: { HOME: join(root, 'home') },
      })

      expect(run.exitCode).toBe(0)
      // A live inner session keeps a usable, empty HOME.
      expect(readdirSync(home('archived'))).toEqual([])
      expect(statSync(home('archived')).mode & 0o777).toBe(0o700)
      expect(existsSync(join(home('other'), '.local', 'bin', 'tccli'))).toBe(true)
      expect(existsSync(join(outside, 'kept'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('forgetRuntimeSessionHome', () => {
  let memory = portabilityDb()
  let busy = false
  let lookups = 0

  useDb({ db: () => memory })
  useRedis({ redisEnabled: () => true })
  useAgentRunStore({
    getActiveAgentRunForSession: async () => (busy ? { streamId: 'active' } : null),
    reserveActiveAgentRunForSession: async () => () => {},
  })
  // Reaching the runtime lookup means every guard passed; no runtime answers.
  useRuntimeRegistry({
    resolveTeamRuntimeEndpoints: async () => {
      lookups += 1

      return []
    },
  })
  beforeEach(() => {
    memory = portabilityDb()
    busy = false
    lookups = 0
    memory.rows('agent_conversations').push({
      sessionId: 'conversation',
      userId: 'owner',
      teamId: 'team',
      runtimeId: 'runtime',
      agentRuntime: 'claude-code',
      archivedAt: new Date(),
    })
  })

  test('reaches the runtime for an archived, idle conversation', async () => {
    await forgetRuntimeSessionHome('conversation')
    expect(lookups).toBe(1)
  })

  test('keeps the home of a conversation restored before the job ran', async () => {
    delete memory.rows('agent_conversations')[0]!.archivedAt
    await forgetRuntimeSessionHome('conversation')
    expect(lookups).toBe(0)
  })

  test('keeps the home while a turn is running', async () => {
    busy = true
    await forgetRuntimeSessionHome('conversation')
    expect(lookups).toBe(0)
  })
})
