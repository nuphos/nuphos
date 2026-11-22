import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it, mock } from 'node:test'

import { buildAtlasError } from '../atlas/error.ts'

import type { LocalSkillImportPick } from './local-skill-import.ts'

const home = mkdtempSync(path.join(os.tmpdir(), 'skill-import-home-'))
const userData = mkdtempSync(path.join(os.tmpdir(), 'skill-import-data-'))
const originalHome = process.env.HOME
const store = new Map<string, number>()
/** Keys whose next upload fails once, as a dropped connection would. */
const failOnce = new Set<string>()
/** The store's listing, capped like the backend's at 5,000 objects. */
let listing: { truncated: boolean } = { truncated: false }

let importLocalSkills: typeof import('./local-skill-import.ts').importLocalSkills
let listLocalSkills: typeof import('./local-skills.ts').listLocalSkills

function writeSkill(root: string, name: string, files: Record<string, string>) {
  for (const [relPath, content] of Object.entries(files)) {
    const full = path.join(home, root, name, relPath)

    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
}

async function pick(id: string): Promise<LocalSkillImportPick> {
  const skill = (await listLocalSkills()).find((found) => found.id === id)

  assert.ok(skill, id)

  return { id, reviewed: skill.files }
}

before(async () => {
  process.env.HOME = home
  mock.module('electron', { namedExports: { app: { getPath: () => userData } } })
  mock.module('../auth/config.ts', {
    namedExports: { readConfig: async () => ({ userInfo: { id: 'u1' } }) },
  })
  mock.module('../atlas.ts', {
    namedExports: {
      teamSkillsListObjects: async () => ({
        objects: listing.truncated ? [] : [...store].map(([key, size]) => ({ key, size })),
        truncated: listing.truncated,
      }),
      teamSkillsGetObject: async (_teamId: string, key: string) => {
        if (!store.has(key))
          throw buildAtlasError('Skill object not found', 'skill_object_not_found')

        return { key, size: store.get(key) }
      },
      teamSkillsPutObject: async (_teamId: string, key: string, file: { bytes: Uint8Array }) => {
        if (key.startsWith('skills/reserved/')) {
          throw buildAtlasError('Cannot create builtin skill', 'reserved_skill_name')
        }
        if (key.startsWith('skills/broken/')) throw buildAtlasError('Storage is full', 'quota')
        if (failOnce.delete(key)) throw buildAtlasError('Connection reset', 'network')
        store.set(key, file.bytes.byteLength)
      },
    },
  })
  for (const name of ['deploy', 'taken', 'reserved', 'broken', 'stale', 'last', 'hidden']) {
    writeSkill('.claude/skills', name, { 'SKILL.md': `---\ndescription: ${name}\n---\n` })
  }
  writeSkill('.agents/skills', 'deploy', { 'SKILL.md': '---\ndescription: codex\n---\n' })
  writeSkill('.claude/skills', 'partial', {
    'SKILL.md': '---\ndescription: partial\n---\n',
    'notes.md': 'notes',
  })
  writeSkill('.agents/skills', 'partial', { 'SKILL.md': '---\ndescription: codex\n---\n' })
  store.set('skills/taken/SKILL.md', 1)
  ;({ importLocalSkills } = await import('./local-skill-import.ts'))
  ;({ listLocalSkills } = await import('./local-skills.ts'))
})

after(() => {
  process.env.HOME = originalHome
  rmSync(home, { recursive: true, force: true })
  rmSync(userData, { recursive: true, force: true })
})

describe('importLocalSkills', () => {
  it('imports each picked skill on its own and reports every outcome', async () => {
    const stale = await pick('claude/stale')

    // Reviewed before a file was added: the fresh walk no longer matches.
    writeSkill('.claude/skills', 'stale', { 'notes.md': 'new' })
    const picks = [
      await pick('claude/deploy'),
      await pick('claude/taken'),
      await pick('claude/reserved'),
      await pick('claude/broken'),
      stale,
      { id: 'claude/gone', reviewed: [] },
      await pick('codex/deploy'),
      await pick('claude/last'),
    ]
    const outcomes = await importLocalSkills('t1', 'personal', picks)

    assert.deepEqual(
      outcomes.map((outcome) => [outcome.id, outcome.status, outcome.reason, outcome.message]),
      [
        ['claude/deploy', 'imported', undefined, undefined],
        ['claude/taken', 'skipped', 'name_taken', undefined],
        ['claude/reserved', 'skipped', 'builtin', undefined],
        ['claude/broken', 'failed', 'error', 'Storage is full'],
        ['claude/stale', 'failed', 'changed', undefined],
        ['claude/gone', 'failed', 'missing', undefined],
        // Same name as the Claude Code skill imported a moment ago.
        ['codex/deploy', 'skipped', 'name_taken', undefined],
        // Failures before it did not stop the batch.
        ['claude/last', 'imported', undefined, undefined],
      ],
    )
    assert.deepEqual(outcomes[0]?.keys, ['skills/deploy/SKILL.md'])
    assert.ok(!store.has('skills/stale/SKILL.md'))
    assert.ok(store.has('skills/last/SKILL.md'))
  })

  it('lets a retry finish a skill whose upload stopped partway', async () => {
    failOnce.add('skills/partial/notes.md')
    const first = await importLocalSkills('t1', 'personal', [
      await pick('claude/partial'),
      await pick('codex/partial'),
    ])

    assert.deepEqual(
      first.map((outcome) => [outcome.id, outcome.status, outcome.reason]),
      [
        ['claude/partial', 'failed', 'error'],
        // Not written into the half-uploaded skill of the same name.
        ['codex/partial', 'skipped', 'name_taken'],
      ],
    )
    const retry = await importLocalSkills('t1', 'personal', [await pick('claude/partial')])

    assert.deepEqual(
      retry.map((outcome) => [outcome.id, outcome.status, outcome.keys]),
      [['claude/partial', 'imported', ['skills/partial/notes.md', 'skills/partial/SKILL.md']]],
    )
  })

  it('never overwrites a skill a truncated listing left out', async () => {
    store.set('skills/hidden/SKILL.md', 7)
    listing = { truncated: true }
    try {
      const outcomes = await importLocalSkills('t1', 'personal', [await pick('claude/hidden')])

      assert.deepEqual(
        outcomes.map((outcome) => [outcome.id, outcome.status, outcome.reason]),
        [['claude/hidden', 'skipped', 'name_taken']],
      )
      assert.equal(store.get('skills/hidden/SKILL.md'), 7)
    } finally {
      listing = { truncated: false }
    }
  })
})
