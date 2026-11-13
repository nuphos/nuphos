import assert from 'node:assert/strict'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, describe, it, mock } from 'node:test'

type Instruction = { id: string; title: string; content: string }
type Team = { objects: Map<string, number>; instructions: Instruction[] }

const teams = new Map<string, Team>()
const failures = { listInstructions: 0, createInstruction: [] as number[] }
// Holds a pass after its snapshot, while it lists the store.
let listGate: Promise<void> | null = null
let creates = 0
let nextId = 0

function team(teamId: string): Team {
  let found = teams.get(teamId)

  if (!found) {
    found = { objects: new Map(), instructions: [] }
    teams.set(teamId, found)
  }

  return found
}

const tick = () => new Promise((resolve) => setImmediate(resolve))
const home = mkdtempSync(path.join(os.tmpdir(), 'local-setup-home-'))
const userData = mkdtempSync(path.join(os.tmpdir(), 'local-setup-data-'))
const originalHome = process.env.HOME

let syncLocalSetup: typeof import('./local-setup-sync.ts').syncLocalSetup
let syncLocalSetupAfter: typeof import('./local-setup-sync.ts').syncLocalSetupAfter
let approveLinkedSkill: typeof import('./local-setup-snapshot.ts').approveLinkedSkill
let listLocalSkills: typeof import('./local-skills.ts').listLocalSkills
let setLocalSetupAutoSync: typeof import('./local-setup-watch.ts').setLocalSetupAutoSync
let setLocalSetupFolders: typeof import('./local-setup-watch.ts').setLocalSetupFolders
let stopLocalSetupWatcher: typeof import('./local-setup-watch.ts').stopLocalSetupWatcher
let resetStateForTests: typeof import('./local-setup-state.ts').resetStateForTests

function writeFile(relPath: string, content: string) {
  const full = path.join(home, relPath)

  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, content)
}

function savedTeams(): Record<
  string,
  { autoSync: boolean; skills: Record<string, unknown>; instructionIds: string[] }
> {
  return (
    JSON.parse(readFileSync(path.join(userData, 'local-setup-sync.json'), 'utf8')) as {
      teams: never
    }
  ).teams
}

before(async () => {
  process.env.HOME = home
  mock.module('electron', { namedExports: { app: { getPath: () => userData } } })
  mock.module('../auth/config.ts', {
    namedExports: { readConfig: async () => ({ userInfo: { id: 'u1' } }) },
  })
  mock.module('../atlas.ts', {
    namedExports: {
      teamSkillsListObjects: async (teamId: string) => {
        await listGate

        return { objects: [...team(teamId).objects].map(([key, size]) => ({ key, size })) }
      },
      teamSkillsPutObject: async (teamId: string, key: string, file: { bytes: Uint8Array }) => {
        await tick()
        team(teamId).objects.set(key, file.bytes.byteLength)
      },
      teamSkillsDeleteObject: async (teamId: string, key: string) => {
        team(teamId).objects.delete(key)
      },
      teamSkillsDeleteSkill: async (teamId: string, name: string) => {
        for (const key of team(teamId).objects.keys()) {
          if (key.startsWith(`skills/${name}/`)) team(teamId).objects.delete(key)
        }
      },
      listInstructions: async (teamId: string) => {
        if (failures.listInstructions > 0) {
          failures.listInstructions -= 1
          throw new Error('transient')
        }

        return {
          personal: team(teamId).instructions,
          team: [],
          canManageTeam: false,
          limits: {
            titleChars: 120,
            contentChars: 8_000,
            snippetsPerScope: 20,
            totalContentCharsPerScope: 24_000,
          },
        }
      },
      createInstruction: async (teamId: string, input: { title: string; content: string }) => {
        creates += 1
        if (failures.createInstruction.includes(creates)) throw new Error('transient')
        nextId += 1
        const created = { id: `i${String(nextId)}`, ...input }

        team(teamId).instructions.push(created)

        return created
      },
      updateInstruction: async (teamId: string, id: string, input: Partial<Instruction>) => {
        const found = team(teamId).instructions.find((item) => item.id === id)

        if (found) Object.assign(found, input)
      },
      deleteInstruction: async (teamId: string, id: string) => {
        team(teamId).instructions = team(teamId).instructions.filter((item) => item.id !== id)
      },
    },
  })
  ;({ syncLocalSetup, syncLocalSetupAfter } = await import('./local-setup-sync.ts'))
  ;({ approveLinkedSkill } = await import('./local-setup-snapshot.ts'))
  ;({ listLocalSkills } = await import('./local-skills.ts'))
  ;({ setLocalSetupAutoSync, setLocalSetupFolders, stopLocalSetupWatcher } =
    await import('./local-setup-watch.ts'))
  ;({ resetStateForTests } = await import('./local-setup-state.ts'))
})

after(() => {
  stopLocalSetupWatcher()
  process.env.HOME = originalHome
  rmSync(home, { recursive: true, force: true })
  rmSync(userData, { recursive: true, force: true })
})

beforeEach(() => {
  teams.clear()
  failures.listInstructions = 0
  failures.createInstruction = []
  creates = 0
  rmSync(path.join(home, '.claude'), { recursive: true, force: true })
  rmSync(path.join(home, '.agents'), { recursive: true, force: true })
  rmSync(path.join(home, '.agents-away'), { recursive: true, force: true })
  rmSync(path.join(userData, 'local-setup-sync.json'), { force: true })
  rmSync(path.join(userData, 'local-setup-hashes.json'), { force: true })
  resetStateForTests()
  writeFile('.claude/skills/deploy/SKILL.md', '---\ndescription: Ship it\n---\n')
  writeFile('.claude/skills/deploy/run.sh', 'echo ok\n')
  writeFile('.claude/skills/triage/SKILL.md', '---\ndescription: Triage\n---\n')
})

describe('syncLocalSetup recovery', () => {
  it('keeps owning skills it uploaded when a later step of the pass fails', async () => {
    failures.listInstructions = 1
    await assert.rejects(syncLocalSetup('t1'), /transient/)
    assert.equal(team('t1').objects.size, 3)
    // Nothing written in memory only: a restart sees the same ownership.
    resetStateForTests()

    const result = await syncLocalSetup('t1')

    assert.equal(result.syncedSkills, 2)
    assert.deepEqual(result.skipped, [])
    assert.equal(result.uploadedFiles, 0)
  })

  it('skips only the skill with an unreadable file, and keeps its synced copy', async () => {
    await syncLocalSetup('t1')
    assert.ok(team('t1').objects.has('skills/deploy/run.sh'))
    writeFile('.claude/skills/deploy/locked.md', 'no')
    chmodSync(path.join(home, '.claude/skills/deploy/locked.md'), 0o000)

    const result = await syncLocalSetup('t1')

    assert.equal(result.syncedSkills, 1)
    assert.equal(result.removedSkills, 0)
    assert.deepEqual(result.skipped, [{ name: 'deploy', reason: 'unreadable' }])
    assert.ok(team('t1').objects.has('skills/triage/SKILL.md'))
    assert.ok(team('t1').objects.has('skills/deploy/run.sh'))
    // Readable again: the next pass picks it back up as its own.
    chmodSync(path.join(home, '.claude/skills/deploy/locked.md'), 0o644)
    assert.equal((await syncLocalSetup('t1')).syncedSkills, 2)
    assert.ok(team('t1').objects.has('skills/deploy/locked.md'))
  })

  it('syncs the rest of a skill that holds a file over the size cap', async () => {
    writeFile('.claude/skills/deploy/archive.bin', 'x'.repeat(10_000_001))

    const result = await syncLocalSetup('t1')

    assert.equal(result.syncedSkills, 2)
    assert.ok(team('t1').objects.has('skills/deploy/run.sh'))
    assert.ok(!team('t1').objects.has('skills/deploy/archive.bin'))
  })

  it('never duplicates CLAUDE.md parts when a create fails part-way', async () => {
    writeFile('.claude/CLAUDE.md', `${'a'.repeat(7_000)}\n${'b'.repeat(7_000)}\n`)
    failures.createInstruction = [2]
    await assert.rejects(syncLocalSetup('t1'), /transient/)
    assert.equal(team('t1').instructions.length, 1)
    resetStateForTests()

    const result = await syncLocalSetup('t1')

    assert.equal(result.instruction, 'synced')
    assert.deepEqual(
      team('t1').instructions.map((item) => item.title),
      ['CLAUDE.md from this computer (1 of 2)', 'CLAUDE.md from this computer (2 of 2)'],
    )
  })
})

describe('syncLocalSetup with linked skills', () => {
  it('re-uploads a Nix-style linked skill when its target changes but size and mtime do not', async () => {
    const store = mkdtempSync(path.join(os.tmpdir(), 'local-setup-store-'))
    const link = path.join(home, '.claude', 'skills', 'nix')

    // Nix store files all carry the same mtime, and these two have the same size.
    for (const [dir, body] of [
      ['v1', 'one'],
      ['v2', 'two'],
    ] as const) {
      mkdirSync(path.join(store, dir))
      writeFileSync(path.join(store, dir, 'SKILL.md'), `---\ndescription: ${body}\n---\n`)
      utimesSync(path.join(store, dir, 'SKILL.md'), 1, 1)
    }
    symlinkSync(path.join(store, 'v1'), link)
    await syncLocalSetup('t1')
    assert.ok(team('t1').objects.has('skills/nix/SKILL.md'))
    unlinkSync(link)
    symlinkSync(path.join(store, 'v2'), link)

    const result = await syncLocalSetup('t1')

    assert.equal(result.uploadedFiles, 1)
    rmSync(store, { recursive: true, force: true })
  })
})

async function approve(teamId: string, name: string) {
  const skill = (await listLocalSkills()).find((found) => found.id === `claude/${name}`)

  assert.ok(skill)
  await approveLinkedSkill(teamId, name, skill.files)
}

describe('syncLocalSetup linked skills', () => {
  it('reads a skill that links outside its folder only once those links are reviewed', async () => {
    const outside = mkdtempSync(path.join(os.tmpdir(), 'local-setup-outside-'))
    const link = path.join(home, '.claude/skills/deploy/id_demo')

    writeFileSync(path.join(outside, 'id_demo'), 'private')
    writeFileSync(path.join(outside, 'other'), 'another file')
    symlinkSync(path.join(outside, 'id_demo'), link)

    let result = await syncLocalSetup('t1')

    assert.deepEqual(result.skipped, [{ name: 'deploy', reason: 'needs_review' }])
    assert.ok(!team('t1').objects.has('skills/deploy/SKILL.md'))
    await approve('t1', 'deploy')
    result = await syncLocalSetup('t1')
    assert.deepEqual(result.skipped, [])
    assert.equal(team('t1').objects.get('skills/deploy/id_demo'), 'private'.length)

    // Re-pointed since the review: the new target is not read and the reviewed copy stays.
    unlinkSync(link)
    symlinkSync(path.join(outside, 'other'), link)
    result = await syncLocalSetup('t1')
    assert.deepEqual(result.skipped, [{ name: 'deploy', reason: 'needs_review' }])
    assert.equal(result.removedSkills, 0)
    assert.equal(team('t1').objects.get('skills/deploy/id_demo'), 'private'.length)
    rmSync(outside, { recursive: true, force: true })
  })

  it('syncs links approved while a pass that skipped them is still running', async () => {
    const outside = mkdtempSync(path.join(os.tmpdir(), 'local-setup-outside-'))
    let release = () => {}

    writeFileSync(path.join(outside, 'id_demo'), 'private')
    symlinkSync(path.join(outside, 'id_demo'), path.join(home, '.claude/skills/deploy/id_demo'))
    listGate = new Promise((resolve) => {
      release = resolve
    })
    const running = syncLocalSetup('t1')

    await new Promise((resolve) => setTimeout(resolve, 100))
    await approve('t1', 'deploy')
    const fresh = syncLocalSetupAfter('t1')

    listGate = null
    release()
    assert.deepEqual((await running).skipped, [{ name: 'deploy', reason: 'needs_review' }])
    assert.deepEqual((await fresh).skipped, [])
    assert.ok(team('t1').objects.has('skills/deploy/id_demo'))
    rmSync(outside, { recursive: true, force: true })
  })

  it('refuses an approval for links that changed since the review', async () => {
    const outside = mkdtempSync(path.join(os.tmpdir(), 'local-setup-outside-'))

    writeFileSync(path.join(outside, 'id_demo'), 'private')
    symlinkSync(path.join(outside, 'id_demo'), path.join(home, '.claude/skills/deploy/id_demo'))
    await assert.rejects(
      approveLinkedSkill('t1', 'deploy', [{ relPath: 'SKILL.md', realPath: '/elsewhere' }]),
      /changed since you reviewed it/,
    )
    rmSync(outside, { recursive: true, force: true })
  })

  it(
    'budgets what a file holds, not the size it reports',
    {
      skip: process.platform !== 'linux',
    },
    async () => {
      symlinkSync('/proc/version', path.join(home, '.claude/skills/deploy/kernel.txt'))
      await approve('t1', 'deploy')
      await syncLocalSetup('t1')

      const { hashes } = JSON.parse(
        readFileSync(path.join(userData, 'local-setup-hashes.json'), 'utf8'),
      ) as { hashes: Record<string, { size: number; bytes?: number }> }
      const kernel = hashes[path.join(home, '.claude/skills/deploy/kernel.txt')]

      assert.equal(kernel?.size, 0)
      assert.ok((kernel.bytes ?? 0) > 0)
    },
  )

  it(
    're-reads a size-0 file every pass, since its stat does not change with it',
    {
      skip: process.platform !== 'linux',
    },
    async () => {
      symlinkSync('/proc/uptime', path.join(home, '.claude/skills/deploy/uptime.txt'))
      await approve('t1', 'deploy')
      await syncLocalSetup('t1')
      await new Promise((resolve) => setTimeout(resolve, 50))

      assert.equal((await syncLocalSetup('t1')).uploadedFiles, 1)
    },
  )
})

describe('syncLocalSetup state', () => {
  it('keeps every team’s records and a mid-pass toggle when passes overlap', async () => {
    writeFile('.claude/CLAUDE.md', '# Rules\n')
    const first = syncLocalSetup('t1')
    const second = syncLocalSetup('t2')

    await tick()
    await setLocalSetupAutoSync('t1', true)
    await Promise.all([first, second])
    stopLocalSetupWatcher()
    const saved = savedTeams()

    assert.equal(saved['u1:t1']?.autoSync, true)
    assert.equal(saved['u1:t2']?.autoSync, false)
    for (const key of ['u1:t1', 'u1:t2']) {
      assert.deepEqual(Object.keys(saved[key]?.skills ?? {}).sort(), ['deploy', 'triage'])
      assert.equal(saved[key]?.instructionIds.length, 1)
    }
  })
})

describe('syncLocalSetup with more folders', () => {
  const claude = () => path.join(home, '.claude', 'skills')
  const codex = () => path.join(home, '.agents', 'skills')

  it('syncs an added folder, a name in two folders from the first, and drops it when removed', async () => {
    writeFile('.agents/skills/review/SKILL.md', '---\ndescription: Review\n---\n')
    writeFile('.agents/skills/deploy/SKILL.md', '---\ndescription: Codex copy\n---\n')

    const result = await setLocalSetupFolders('t1', [codex()])

    assert.equal(result.syncedSkills, 3)
    assert.ok(team('t1').objects.has('skills/review/SKILL.md'))
    // The first folder's copy: Codex's deploy has no run.sh.
    assert.ok(team('t1').objects.has('skills/deploy/run.sh'))
    assert.deepEqual(result.skipped, [
      { name: 'deploy', reason: 'name_clash', folder: codex(), syncedFrom: claude() },
    ])
    assert.deepEqual(result.sources, { deploy: claude(), review: codex(), triage: claude() })

    const removed = await setLocalSetupFolders('t1', [])

    assert.equal(removed.removedSkills, 1)
    assert.equal(team('t1').objects.has('skills/review/SKILL.md'), false)
    assert.ok(team('t1').objects.has('skills/deploy/run.sh'))
  })

  it('keeps what a folder synced while the folder cannot be read, as an unmounted drive', async () => {
    writeFile('.agents/skills/review/SKILL.md', '---\ndescription: Review\n---\n')
    await setLocalSetupFolders('t1', [codex()])
    renameSync(path.join(home, '.agents'), path.join(home, '.agents-away'))

    const away = await syncLocalSetup('t1')

    assert.equal(away.removedSkills, 0)
    assert.ok(team('t1').objects.has('skills/review/SKILL.md'))
    // Two passes away still hold it: the folder is remembered with the skill.
    assert.equal((await syncLocalSetup('t1')).removedSkills, 0)
    renameSync(path.join(home, '.agents-away'), path.join(home, '.agents'))
    assert.equal((await syncLocalSetup('t1')).sources?.review, codex())
  })

  it('keeps only absolute folders, once each, and never ~/.claude/skills again', async () => {
    writeFile('.agents/skills/review/SKILL.md', '---\ndescription: Review\n---\n')
    await setLocalSetupFolders('t1', ['relative/skills', codex(), `${codex()}/`, claude()])

    assert.deepEqual((savedTeams() as Record<string, { folders?: string[] }>)['u1:t1']?.folders, [
      codex(),
    ])
  })
})
