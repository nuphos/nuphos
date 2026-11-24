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

import { cleanUpArchived, retryArchivedHomes } from '@/lib/agent/archive-cleanup'
import { useDb } from '@/lib/test/doubles/db'
import { useLocalRuntimeCatalog } from '@/lib/test/doubles/local-runtime-catalog'
import { real, useObservability } from '@/lib/test/doubles/observability'
import { useRuntimeCatalog } from '@/lib/test/doubles/runtime-catalog'
import { useRuntimeRegistry } from '@/lib/test/doubles/runtime-registry'
import { useSessionExecutionState } from '@/lib/test/doubles/session-execution-state'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import { controlRegistry } from './agent-chat-registry'
import {
  RECLAIM_SESSION_HOME_PROGRAM,
  reclaimPendingArchiveHome,
  reclaimSessionHomes,
} from './runtime-session-home'
import { runtimeGone } from './runtime-refusal'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

// The program reads /proc, which only Linux runtimes have.
describe.skipIf(!existsSync('/proc/self'))('RECLAIM_SESSION_HOME_PROGRAM', () => {
  let root = ''
  const home = (id: string) => join(root, 'home', '.nuphos', 'session-homes', hash(id))
  // Where a teammate's turns in the conversation keep their CLI state.
  const guestHome = (id: string, actor: string) => `${home(id)}.${hash(actor)}`
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

  // Runs the program as a computer's own job does: the session id on stdin.
  const reclaimAsJob = (sessionId: string, epoch?: number) => {
    const run = Bun.spawnSync([process.execPath, '-e', RECLAIM_SESSION_HOME_PROGRAM], {
      env: { HOME: join(root, 'home') },
      stdin: Buffer.from(JSON.stringify({ sessionId, ...(epoch === undefined ? {} : { epoch }) })),
    })

    expect(run.exitCode).toBe(0)

    return (JSON.parse(run.stdout.toString()) as { result: string }).result
  }

  // Only the gateway that launched the job is the runtime's tree: an unreadable
  // process elsewhere in the person's login session keeps nothing.
  test("as a computer's own job, takes the session id on stdin", () => {
    expect(reclaimAsJob('archived')).toBe('removed')
    expect(existsSync(home('archived'))).toBe(false)
    expect(existsSync(home('other'))).toBe(true)
  })

  test('an in-flight old job cannot remove a home created after restore', async () => {
    // @ts-expect-error Runtime adapter is JavaScript and has no TypeScript declarations.
    const { nuphosSessionHomeEnv } = await import('../../../../runtime/image/session-home.mjs')
    const runtimeEnv = { HOME: join(root, 'home') }
    const oldHome = nuphosSessionHomeEnv(
      { NUPHOS_SESSION_ID: 'archived', NUPHOS_SESSION_HOME_EPOCH: '1' },
      runtimeEnv,
    ).HOME
    const gate = join(root, 'reclaim-ready')
    const release = join(root, 'resume-reclaim')
    const point = '  const moved = await fs.rename(home, aside).then('
    const hook = `  await fs.writeFile(${JSON.stringify(gate)}, 'ready')\n  while (!(await fs.stat(${JSON.stringify(release)}).catch(() => null))) await new Promise(r => setTimeout(r, 10))\n`

    expect(RECLAIM_SESSION_HOME_PROGRAM.includes(point)).toBe(true)
    const child = Bun.spawn(
      [process.execPath, '-e', RECLAIM_SESSION_HOME_PROGRAM.replace(point, hook + point)],
      {
        env: { HOME: join(root, 'home') },
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )

    await child.stdin.write(JSON.stringify({ sessionId: 'archived', epoch: 1 }))
    await child.stdin.end()
    try {
      const deadline = Date.now() + 5000

      while (!existsSync(gate) && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 10))
      expect(existsSync(gate)).toBe(true)
      // A restored Task has a new generation; the new turn ends before this old job resumes.
      const newHome = nuphosSessionHomeEnv(
        { NUPHOS_SESSION_ID: 'archived', NUPHOS_SESSION_HOME_EPOCH: '2' },
        runtimeEnv,
      ).HOME

      writeFileSync(join(newHome, 'new-data'), 'fictional restored data')
      writeFileSync(release, 'go')
      expect(await child.exited).toBe(0)
      expect(JSON.parse(await new Response(child.stdout).text()).result).toBe('removed')
      expect(existsSync(oldHome)).toBe(false)
      expect(readFileSync(join(newHome, 'new-data'), 'utf8')).toBe('fictional restored data')
      expect(existsSync(home('other'))).toBe(true)
    } finally {
      child.kill()
    }
  })

  test('a delayed old-generation job removes its generation and older ones, not a restored home', () => {
    const oldGeneration = `${home('archived')}.g-1`
    const restoredGeneration = `${home('archived')}.g-2`

    mkdirSync(oldGeneration)
    mkdirSync(`${oldGeneration}.${hash('teammate')}`)
    mkdirSync(restoredGeneration)
    writeFileSync(join(restoredGeneration, 'new-data'), 'fixture')
    expect(reclaimAsJob('archived', 1)).toBe('removed')
    expect(existsSync(oldGeneration)).toBe(false)
    expect(existsSync(`${oldGeneration}.${hash('teammate')}`)).toBe(false)
    expect(existsSync(home('archived'))).toBe(false)
    expect(existsSync(join(restoredGeneration, 'new-data'))).toBe(true)
    expect(existsSync(home('other'))).toBe(true)
  })

  // A computer from before generations ran the restored Task's turn in the first home;
  // archived again, only the later generation is queued (#4473).
  test('a generation job removes an older home it was not queued for', () => {
    expect(reclaimAsJob('archived', 1)).toBe('removed')
    expect(existsSync(home('archived'))).toBe(false)
    expect(existsSync(home('other'))).toBe(true)
  })

  test("as a computer's own job, keeps a home a process under the gateway uses", () => {
    const shell = Bun.spawn(['sleep', '30'], {
      env: { HOME: home('archived'), PATH: '/bin:/usr/bin' },
    })

    try {
      expect(reclaimAsJob('archived')).toBe('in_use')
      expect(existsSync(home('archived'))).toBe(true)
    } finally {
      shell.kill()
    }
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

  // Starts a process whose parent exits at once, so pid 1 (or a subreaper)
  // adopts it, as a background shell left by a finished turn is.
  const orphan = (options: { home?: string; cwd?: string }) => {
    const run = Bun.spawnSync(['sh', '-c', 'setsid sleep 30 >/dev/null 2>&1 & echo $!'], {
      cwd: options.cwd,
      env: { HOME: options.home ?? '/nonexistent', PATH: '/bin:/usr/bin' },
    })

    return Number(run.stdout.toString().trim())
  }

  test('keeps a home an orphaned process uses as HOME', () => {
    const pid = orphan({ home: home('archived') })

    try {
      expect(reclaim('archived')).toBe('in_use')
      expect(existsSync(join(home('archived'), '.local', 'bin', 'tccli'))).toBe(true)
    } finally {
      process.kill(pid)
    }
  })

  test('keeps a home an orphaned process works inside', () => {
    const pid = orphan({ cwd: join(home('archived'), '.local') })

    try {
      expect(reclaim('archived')).toBe('in_use')
    } finally {
      process.kill(pid)
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

  test("removes teammates' homes with the owner's, and only this conversation's", () => {
    mkdirSync(guestHome('archived', 'guest'), { recursive: true })
    mkdirSync(guestHome('other', 'guest'), { recursive: true })

    expect(reclaim('archived')).toBe('removed')
    expect(existsSync(home('archived'))).toBe(false)
    expect(existsSync(guestHome('archived', 'guest'))).toBe(false)
    expect(existsSync(guestHome('other', 'guest'))).toBe(true)
  })

  test("removes a teammate's home when the owner's is already gone", () => {
    rmSync(home('archived'), { recursive: true })
    mkdirSync(guestHome('archived', 'guest'), { recursive: true })

    expect(reclaim('archived')).toBe('removed')
    expect(existsSync(guestHome('archived', 'guest'))).toBe(false)
  })

  test("keeps a teammate's home that a running process uses, and reports it", () => {
    mkdirSync(guestHome('archived', 'guest'), { recursive: true })
    const shell = Bun.spawn(['sleep', '30'], {
      env: { HOME: guestHome('archived', 'guest'), PATH: '/bin:/usr/bin' },
    })

    try {
      expect(reclaim('archived')).toBe('in_use')
      expect(existsSync(guestHome('archived', 'guest'))).toBe(true)
    } finally {
      shell.kill()
    }
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

  test("removes a set-aside teammate's home a killed run left behind", () => {
    const left = `${guestHome('archived', 'guest')}.reclaim-${String(Date.now() - 11 * 60_000)}-left`

    mkdirSync(left, { recursive: true })

    expect(reclaim('archived')).toBe('removed')
    expect(existsSync(left)).toBe(false)
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

describe('reclaimSessionHomes', () => {
  const now = new Date('2026-10-13T20:00:00Z')
  const archivedAt = new Date('2026-10-13T19:00:00Z')
  // An agent on a computer (a Box or someone's own) is reached over its control channel.
  const LOCAL = 'local_owner_device'
  const { acquire, runtimeJobs } = controlRegistry
  // What the reclaim program reports, the jobs it was sent, and computers offline.
  let report = '{"result":"removed"}'
  let timedOut = false
  let jobs: { runtimeId: string; job: string; stdin: string }[] = []
  let offline: string[] = []
  let offered = ['panel']
  let memory = portabilityDb()
  let state = 'dormant'
  let onProbe = () => {}
  // Team runtimes: what the catalog knows and where each one is reached.
  let instances: { id: string; provider: string }[] = []
  let endpoints: { runtimeId: string; url: string }[] = []

  // Why each queued home was left for the next sweep.
  let waits: unknown[] = []

  useObservability({
    logEvent: (level, event, fields) => {
      if (event === 'agent.session_home_reclaim.waiting') waits.push(fields)
      else real.logEvent(level, event, fields)
    },
  })
  useDb({ db: () => memory })
  useSessionExecutionState({
    conversationExecutionState: async () => {
      onProbe()

      return { state }
    },
  })
  useRuntimeRegistry({ resolveTeamRuntimeEndpoints: async () => endpoints })
  useLocalRuntimeCatalog({
    resolveLocalRuntimeEndpoint: async (_teamId: string, runtimeId: string, userId: string) => {
      if (userId !== 'owner' || offline.includes(runtimeId)) throw new Error('offline')

      return { runtimeId, url: `wss://${runtimeId}/acp` }
    },
  })
  useRuntimeCatalog({
    requireRuntimeInstance: async (_teamId: string, id: string) => {
      const instance = instances.find((candidate) => candidate.id === id)

      if (!instance) throw runtimeGone()

      return instance
    },
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
    waits = []
    state = 'dormant'
    onProbe = () => {}
    instances = []
    endpoints = []
    report = '{"result":"removed"}'
    timedOut = false
    jobs = []
    offline = []
    offered = ['panel']
    controlRegistry.runtimeJobs = () => offered
    controlRegistry.acquire = (async (_teamId: string, endpoint: { runtimeId: string }) => ({
      runJob: async (request: { job: string; stdin: string }) => {
        jobs.push({ runtimeId: endpoint.runtimeId, job: request.job, stdin: request.stdin })

        return timedOut ? { exitCode: -1, stdout: '', timedOut } : { exitCode: 0, stdout: report }
      },
    })) as never
  })
  afterEach(() => {
    controlRegistry.acquire = acquire
    controlRegistry.runtimeJobs = runtimeJobs
  })

  test('a capable runtime reclaims only the queued generations', async () => {
    const row = conversation({
      archivedAt: undefined,
      archiveHomePendingEpochs: [
        { epoch: 0, runtimeId: LOCAL, provider: 'claude-code' },
        { epoch: 1, runtimeId: LOCAL, provider: 'claude-code' },
      ],
    })

    offered = ['session-homes', 'session-homes-v2']

    expect(await reclaimPendingArchiveHome('conversation', now)).toBe(true)
    expect(jobs.map((job) => JSON.parse(job.stdin).epoch)).toEqual([0, 1])
    expect(row.archiveHomePendingEpochs).toEqual([])
  })

  // Two reclaims of one home at once: the second finds it set aside and reports
  // it absent while the first is still removing it (#4629). The sweep alone owns it.
  test('archiving leaves the home to the sweep, which keeps a timed-out one queued', async () => {
    const row = conversation({
      archiveHomePendingEpochs: [{ epoch: 0, runtimeId: LOCAL, provider: 'claude-code' }],
    })

    offered = ['session-homes', 'session-homes-v2']
    await cleanUpArchived(['conversation'])
    expect(jobs).toEqual([])
    expect(row.archiveHomePendingEpochs).toHaveLength(1)

    timedOut = true
    await retryArchivedHomes()
    expect(row.archiveHomePendingEpochs).toHaveLength(1)
    expect(row.sessionHomeReclaimedAt).toBeUndefined()

    // The next sweep's job removes the set-aside home the timed-out one left.
    timedOut = false
    await retryArchivedHomes()
    expect(jobs).toHaveLength(2)
    expect(row.archiveHomePendingEpochs).toEqual([])
    expect(row.sessionHomeReclaimedAt).toBeInstanceOf(Date)
  })

  test('an offline computer retains its queued generation', async () => {
    offline = [LOCAL]
    instances = [{ id: LOCAL, provider: 'claude-code' }]
    const row = conversation({
      archivedAt: undefined,
      archiveHomePendingEpochs: [{ epoch: 0, runtimeId: LOCAL, provider: 'claude-code' }],
    })

    expect(await reclaimPendingArchiveHome('conversation', now)).toBe(false)
    expect(row.archiveHomePendingEpochs).toEqual([
      { epoch: 0, runtimeId: LOCAL, provider: 'claude-code' },
    ])
    expect(jobs).toHaveLength(0)
  })

  test('a generation whose computer is off does not hold back one on another computer', async () => {
    const off = 'local_owner_off'

    offline = [off]
    instances = [{ id: off, provider: 'claude-code' }]
    offered = ['session-homes', 'session-homes-v2']
    const row = conversation({
      archiveHomePendingEpochs: [
        { epoch: 0, runtimeId: off, provider: 'claude-code' },
        { epoch: 1, runtimeId: LOCAL, provider: 'claude-code' },
      ],
    })

    expect(await reclaimPendingArchiveHome('conversation', now)).toBe(false)
    expect(jobs.map((job) => [job.runtimeId, JSON.parse(job.stdin).epoch])).toEqual([[LOCAL, 1]])
    expect(row.archiveHomePendingEpochs).toEqual([
      { epoch: 0, runtimeId: off, provider: 'claude-code' },
    ])
  })

  test('a queued home that waits says why', async () => {
    const off = 'local_owner_off'

    offline = [off]
    instances = [{ id: off, provider: 'claude-code' }]
    offered = ['session-homes', 'session-homes-v2']
    report = '{"result":"in_use"}'
    const queued = [
      { epoch: 0, runtimeId: off, provider: 'claude-code' },
      { epoch: 1, runtimeId: LOCAL, provider: 'claude-code' },
    ]
    const row = conversation({ archiveHomePendingEpochs: queued })

    expect(await reclaimPendingArchiveHome('conversation', now)).toBe(false)
    expect(row.archiveHomePendingEpochs).toEqual(queued)
    expect(waits).toEqual([
      { session_id: 'conversation', runtime_id: off, epoch: 0, reason: 'runtime_unreachable' },
      { session_id: 'conversation', runtime_id: LOCAL, epoch: 1, reason: 'in_use' },
    ])
  })

  test('after moving, an old generation is reclaimed on its original runtime', async () => {
    const old = 'local_owner_old'
    const row = conversation({
      runtimeId: LOCAL,
      archivedAt: undefined,
      archiveHomePendingEpochs: [{ epoch: 0, runtimeId: old, provider: 'claude-code' }],
    })

    offered = ['session-homes', 'session-homes-v2']
    offline = [old]
    instances = [{ id: old, provider: 'claude-code' }]

    expect(await reclaimPendingArchiveHome('conversation', now)).toBe(false)
    expect(jobs).toHaveLength(0)
    expect(row.archiveHomePendingEpochs).toHaveLength(1)
    offline = []
    expect(await reclaimPendingArchiveHome('conversation', now)).toBe(true)
    expect(jobs.map((job) => job.runtimeId)).toEqual([old])
    expect(row.archiveHomePendingEpochs).toEqual([])
  })

  test('an older runtime never gets a delete from the archive queue, even if restored meanwhile', async () => {
    const row = conversation({
      archiveHomePendingEpochs: [{ epoch: 0, runtimeId: LOCAL, provider: 'claude-code' }],
    })
    const connect = controlRegistry.acquire

    offered = ['session-homes', 'panel']
    // The Task is restored after cleanup read the archived row, while it reaches the runtime.
    controlRegistry.acquire = ((...args: Parameters<typeof connect>) => {
      row.archivedAt = undefined

      return connect(...args)
    }) as never

    expect(await reclaimPendingArchiveHome('conversation', now)).toBe(true)
    expect(jobs).toHaveLength(0)
    expect(row.archiveHomePendingEpochs).toEqual([])
    // Left to the hourly sweep, which re-reads the row and finds it restored.
    expect(row.sessionHomeReclaimedAt).toBeUndefined()
    expect(await reclaimSessionHomes(now)).toBe(0)
    expect(jobs).toHaveLength(0)
  })

  test('an older runtime leaves an archived single home to the hourly sweep', async () => {
    const row = conversation({
      archiveHomePendingEpochs: [{ epoch: 0, runtimeId: LOCAL, provider: 'claude-code' }],
    })

    offered = ['session-homes', 'panel']

    expect(await reclaimPendingArchiveHome('conversation', now)).toBe(true)
    expect(jobs).toHaveLength(0)
    expect(await reclaimSessionHomes(now)).toBe(1)
    expect(jobs.map(({ job, stdin }) => [job, JSON.parse(stdin)])).toEqual([
      ['session-homes', { sessionId: 'conversation' }],
    ])
    expect(row.sessionHomeReclaimedAt).toEqual(now)
  })

  for (const order of [
    [0, 1],
    [1, 0],
  ])
    test(`a generation reclaimed on a newer runtime leaves a later archive on an older one to the sweep, queued ${order}`, async () => {
      const old = 'local_owner_old'
      const queued = { 0: old, 1: LOCAL } as Record<number, string>
      const row = conversation({
        sessionHomeEpoch: 1,
        archiveHomePendingEpochs: order.map((epoch) => ({
          epoch,
          runtimeId: queued[epoch],
          provider: 'claude-code',
        })),
      })

      controlRegistry.runtimeJobs = ((_teamId: string, endpoint: { runtimeId: string }) =>
        endpoint.runtimeId === old
          ? ['session-homes', 'session-homes-v2']
          : ['session-homes']) as never

      expect(await reclaimPendingArchiveHome('conversation', now)).toBe(true)
      expect(jobs.map(({ runtimeId, stdin }) => [runtimeId, JSON.parse(stdin).epoch])).toEqual([
        [old, 0],
      ])
      expect(row.sessionHomeReclaimedAt).toBeUndefined()
      expect(await reclaimSessionHomes(now)).toBe(1)
      expect(jobs.map(({ runtimeId, stdin }) => [runtimeId, JSON.parse(stdin)])).toEqual([
        [old, { sessionId: 'conversation', epoch: 0 }],
        [LOCAL, { sessionId: 'conversation' }],
      ])
      expect(row.sessionHomeReclaimedAt).toEqual(now)
    })

  test('drops a generation with no team or runtime to reclaim it on', async () => {
    const noRuntime = conversation({
      archiveHomePendingEpochs: [{ epoch: 0, runtimeId: null, provider: 'claude-code' }],
    })
    const noTeam = conversation({
      sessionId: 'personal',
      teamId: undefined,
      archiveHomePendingEpochs: [{ epoch: 0, runtimeId: LOCAL, provider: 'claude-code' }],
    })

    expect(await reclaimPendingArchiveHome('conversation', now)).toBe(true)
    expect(await reclaimPendingArchiveHome('personal', now)).toBe(true)
    expect(jobs).toHaveLength(0)
    expect(noRuntime.archiveHomePendingEpochs).toEqual([])
    expect(noTeam.archiveHomePendingEpochs).toEqual([])
  })

  test('drops a generation whose runtime was removed, but keeps one that is only offline', async () => {
    const removed = 'local_owner_removed'
    const row = conversation({
      archiveHomePendingEpochs: [
        { epoch: 0, runtimeId: removed, provider: 'claude-code' },
        { epoch: 1, runtimeId: LOCAL, provider: 'claude-code' },
      ],
    })

    offline = [removed, LOCAL]
    instances = [{ id: LOCAL, provider: 'claude-code' }]

    expect(await reclaimPendingArchiveHome('conversation', now)).toBe(false)
    expect(row.archiveHomePendingEpochs).toEqual([
      { epoch: 1, runtimeId: LOCAL, provider: 'claude-code' },
    ])
    expect(jobs).toHaveLength(0)
  })

  test("reclaims an archived conversation's home on its computer", async () => {
    const row = conversation({})

    expect(await reclaimSessionHomes(now)).toBe(1)
    expect(row.sessionHomeReclaimedAt).toEqual(now)
    expect(jobs.map((job) => job.runtimeId)).toEqual([LOCAL])
    expect(JSON.parse(jobs[0]?.stdin ?? '{}')).toEqual({
      runner: RECLAIM_SESSION_HOME_PROGRAM,
      script: '',
      params: { sessionId: 'conversation' },
    })
  })

  test("a computer's own job gets only the session id, and is used over panel", async () => {
    offered = ['attachments', 'session-homes']
    const row = conversation({})

    expect(await reclaimSessionHomes(now)).toBe(1)
    expect(row.sessionHomeReclaimedAt).toEqual(now)
    expect(jobs).toEqual([
      {
        runtimeId: LOCAL,
        job: 'session-homes',
        stdin: JSON.stringify({ sessionId: 'conversation' }),
      },
    ])
  })

  test('retries on a computer that offers neither job', async () => {
    offered = ['attachments']
    const row = conversation({})

    expect(await reclaimSessionHomes(now)).toBe(0)
    expect(row.sessionHomeReclaimedAt).toBeUndefined()
    expect(jobs).toEqual([])
  })

  test('retries while a process still uses the home', async () => {
    report = '{"result":"in_use"}'
    const row = conversation({})

    expect(await reclaimSessionHomes(now)).toBe(0)
    expect(row.sessionHomeReclaimedAt).toBeUndefined()
  })

  test('retries while the computer is offline', async () => {
    offline = [LOCAL]
    const row = conversation({})

    expect(await reclaimSessionHomes(now)).toBe(0)
    expect(row.sessionHomeReclaimedAt).toBeUndefined()
  })

  test('skips one already reclaimed since it was archived', async () => {
    conversation({ sessionHomeReclaimedAt: now })
    expect(await reclaimSessionHomes(now)).toBe(0)
  })

  test('reclaims again after a later archive', async () => {
    conversation({ sessionHomeReclaimedAt: new Date('2026-10-01T00:00:00Z') })
    expect(await reclaimSessionHomes(now)).toBe(1)
  })

  test('retries while the runtime still runs the session', async () => {
    state = 'idle'
    const row = conversation({ runtimeId: 'development-claude-code' })

    expect(await reclaimSessionHomes(now)).toBe(0)
    expect(row.sessionHomeReclaimedAt).toBeUndefined()
  })

  test('retries while the runtime cannot be resolved', async () => {
    const row = conversation({ runtimeId: 'gone' })

    expect(await reclaimSessionHomes(now)).toBe(0)
    expect(row.sessionHomeReclaimedAt).toBeUndefined()
  })

  test('keeps the home of a conversation restored while the sweep ran', async () => {
    state = 'idle'
    conversation({ sessionId: 'first', runtimeId: 'development-claude-code' })
    const restored = conversation({ sessionId: 'second' })

    onProbe = () => {
      delete restored.archivedAt
    }
    expect(await reclaimSessionHomes(now)).toBe(0)
    expect(restored.sessionHomeReclaimedAt).toBeUndefined()
  })

  test('ignores conversations that are not archived', async () => {
    conversation({ archivedAt: undefined, lastActiveAt: new Date('2026-10-12T00:00:00Z') })
    expect(await reclaimSessionHomes(now)).toBe(0)
  })

  // A move queues the home it left (#5047); the sweep has no move of its own to follow.
  test('leaves a moved conversation to the archive queue', async () => {
    conversation({
      archivedAt: undefined,
      runtimeMigration: {
        fromRuntimeId: 'local_owner_laptop',
        toRuntimeId: LOCAL,
        movedAt: archivedAt,
      },
    })
    expect(await reclaimSessionHomes(now)).toBe(0)
    expect(jobs).toEqual([])
  })

  describe('trigger runs', () => {
    const run = (lastActiveAt: Date, fields: Record<string, unknown> = {}) =>
      conversation({
        archivedAt: undefined,
        lastActiveAt,
        metadata: { trigger: { id: 't' } },
        ...fields,
      })

    test('reclaims one whose inner session has expired', async () => {
      const lastActiveAt = new Date('2026-10-13T15:59:00Z')
      const row = run(lastActiveAt)

      expect(await reclaimSessionHomes(now)).toBe(1)
      expect(row.sessionHomeReclaimedAt).toEqual(now)
    })

    test('keeps one that ran within the session TTL', async () => {
      const row = run(new Date('2026-10-13T16:01:00Z'))

      expect(await reclaimSessionHomes(now)).toBe(0)
      expect(row.sessionHomeReclaimedAt).toBeUndefined()
    })

    test('reclaims again after a later turn', async () => {
      run(new Date('2026-10-13T12:00:00Z'), {
        sessionHomeReclaimedAt: new Date('2026-10-13T08:00:00Z'),
      })
      expect(await reclaimSessionHomes(now)).toBe(1)
    })

    test('skips one already reclaimed since its last turn', async () => {
      run(new Date('2026-10-13T12:00:00Z'), {
        sessionHomeReclaimedAt: new Date('2026-10-13T17:00:00Z'),
      })
      expect(await reclaimSessionHomes(now)).toBe(0)
    })

    test('keeps the home of one resumed while the sweep ran', async () => {
      state = 'idle'
      run(new Date('2026-10-13T12:00:00Z'), {
        sessionId: 'first',
        runtimeId: 'development-claude-code',
      })
      const resumed = run(new Date('2026-10-13T12:00:00Z'), { sessionId: 'second' })

      onProbe = () => {
        resumed.lastActiveAt = new Date('2026-10-13T19:59:00Z')
      }
      expect(await reclaimSessionHomes(now)).toBe(0)
      expect(resumed.sessionHomeReclaimedAt).toBeUndefined()
    })
  })
})
