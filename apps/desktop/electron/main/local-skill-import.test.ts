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
        objects: [...store].map(([key, size]) => ({ key, size })),
      }),
      teamSkillsPutObject: async (_teamId: string, key: string, file: { bytes: Uint8Array }) => {
        if (key.startsWith('skills/reserved/')) {
          throw buildAtlasError('Cannot create builtin skill', 'reserved_skill_name')
        }
        if (key.startsWith('skills/broken/')) throw buildAtlasError('Storage is full', 'quota')
        store.set(key, file.bytes.byteLength)
      },
    },
  })
  for (const name of ['deploy', 'taken', 'reserved', 'broken', 'stale', 'last']) {
    writeSkill('.claude/skills', name, { 'SKILL.md': `---\ndescription: ${name}\n---\n` })
  }
  writeSkill('.agents/skills', 'deploy', { 'SKILL.md': '---\ndescription: codex\n---\n' })
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
})
