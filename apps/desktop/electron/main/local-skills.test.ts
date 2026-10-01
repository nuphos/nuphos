import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

import { listLocalSkills, localSkillEntries, skillDescription } from './local-skills.ts'

const originalHome = process.env.HOME
let home: string
let outside: string

function writeSkill(root: string, files: Record<string, string>) {
  for (const [relPath, content] of Object.entries(files)) {
    const full = path.join(root, relPath)

    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
}

before(() => {
  home = mkdtempSync(path.join(os.tmpdir(), 'local-skills-'))
  outside = mkdtempSync(path.join(os.tmpdir(), 'outside-'))
  process.env.HOME = home
  writeSkill(outside, { 'SKILL.md': '---\ndescription: Not yours\n---\n', 'secret.txt': 'private' })
  writeSkill(path.join(home, '.claude', 'skills', 'deploy'), {
    'SKILL.md': '---\nname: deploy\ndescription: "Ship the service"\n---\n\nSteps.\n',
    'scripts/run.sh': '#!/bin/sh\necho ok\n',
    'node_modules/junk.js': 'ignored',
  })
  writeSkill(path.join(home, '.agents', 'skills', 'triage'), {
    'SKILL.md': '---\ndescription: Triage alerts\n---\n',
  })
  // No SKILL.md — a directory that merely sits next to the skills.
  mkdirSync(path.join(home, '.claude', 'skills', 'notes'), { recursive: true })
  // A skill root that is really a link out of the skills directory, and a linked
  // file inside a real skill: neither may become importable.
  symlinkSync(outside, path.join(home, '.claude', 'skills', 'linked'))
  symlinkSync(
    path.join(outside, 'secret.txt'),
    path.join(home, '.claude', 'skills', 'deploy', 'secret.txt'),
  )
})

after(() => {
  process.env.HOME = originalHome
})

describe('skillDescription', () => {
  it('reads the frontmatter description and strips quotes', () => {
    assert.equal(skillDescription('---\ndescription: "Ship it"\n---\nbody'), 'Ship it')
  })

  it('returns null without frontmatter or without a description', () => {
    assert.equal(skillDescription('# Just a heading'), null)
    assert.equal(skillDescription('---\nname: deploy\n---\n'), null)
  })
})

describe('listLocalSkills', () => {
  it('lists both agents’ skill folders, skipping no-SKILL.md and symlinked roots', async () => {
    const skills = await listLocalSkills()

    assert.deepEqual(
      skills.map((skill) => [skill.id, skill.description, skill.fileCount]),
      [
        ['claude/deploy', 'Ship the service', 2],
        ['codex/triage', 'Triage alerts', 1],
      ],
    )
  })
})

describe('localSkillEntries', () => {
  it('returns SKILL.md first and ignores node_modules and symlinked files', async () => {
    const entries = await localSkillEntries(path.join(home, '.claude', 'skills', 'deploy'))

    assert.deepEqual(
      entries.map((entry) => entry.relPath),
      ['SKILL.md', 'scripts/run.sh'],
    )
  })
})
