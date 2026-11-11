import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

import { listLocalSkills, localSkillEntries, skillDescription } from './local-skills.ts'

const originalHome = process.env.HOME
let home: string
let outside: string
let store: string

function writeSkill(root: string, files: Record<string, string>) {
  for (const [relPath, content] of Object.entries(files)) {
    const full = path.join(root, relPath)

    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
}

function skillDir(name: string) {
  return path.join(home, '.claude', 'skills', name)
}

async function relPaths(root: string, readOnlyRoots?: string[]) {
  return (await localSkillEntries(root, readOnlyRoots)).map((entry) => entry.relPath)
}

before(() => {
  home = mkdtempSync(path.join(os.tmpdir(), 'local-skills-'))
  outside = mkdtempSync(path.join(os.tmpdir(), 'outside-'))
  store = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'store-')))
  process.env.HOME = home
  writeSkill(outside, { 'SKILL.md': '---\ndescription: Not yours\n---\n', 'secret.txt': 'private' })
  writeSkill(skillDir('deploy'), {
    'SKILL.md': '---\nname: deploy\ndescription: "Ship the service"\n---\n\nSteps.\n',
    'scripts/run.sh': '#!/bin/sh\necho ok\n',
    'node_modules/junk.js': 'ignored',
  })
  writeSkill(path.join(home, '.agents', 'skills', 'triage'), {
    'SKILL.md': '---\ndescription: Triage alerts\n---\n',
  })
  // No SKILL.md — a directory that merely sits next to the skills.
  mkdirSync(skillDir('notes'), { recursive: true })
  // Links out of the skill and the skills directory, to a file, a directory and nowhere.
  symlinkSync(path.join(outside, 'secret.txt'), path.join(skillDir('deploy'), 'secret.txt'))
  symlinkSync(outside, path.join(skillDir('deploy'), 'elsewhere'))
  symlinkSync(path.join(outside, 'missing'), path.join(skillDir('deploy'), 'dangling'))
  // A link to a file elsewhere inside the skills directory, as gstack installs
  // its skills, is followed.
  writeSkill(skillDir('shared'), { 'guide.md': '# Guide\n' })
  symlinkSync(path.join(skillDir('shared'), 'guide.md'), path.join(skillDir('deploy'), 'guide.md'))
  // Nix home-manager: the skill root is a link into the store.
  writeSkill(path.join(store, 'aaa-review'), {
    'SKILL.md': '---\ndescription: Review code\n---\n',
    'refs/style.md': '# Style\n',
  })
  symlinkSync(path.join(store, 'aaa-review'), skillDir('review'))
  // symlinkJoin: a store directory of per-file links into other store paths.
  writeSkill(path.join(store, 'bbb-lint'), { 'SKILL.md': '---\ndescription: Lint\n---\n' })
  mkdirSync(path.join(store, 'ccc-skills', 'lint'), { recursive: true })
  symlinkSync(
    path.join(store, 'bbb-lint', 'SKILL.md'),
    path.join(store, 'ccc-skills', 'lint', 'SKILL.md'),
  )
  symlinkSync(path.join(store, 'ccc-skills', 'lint'), skillDir('lint'))
  // Links back up the tree must not loop.
  writeSkill(skillDir('loop'), { 'SKILL.md': '---\ndescription: Loops\n---\n' })
  mkdirSync(path.join(skillDir('loop'), 'sub'))
  symlinkSync(skillDir('loop'), path.join(skillDir('loop'), 'sub', 'up'))
  symlinkSync('.', path.join(skillDir('loop'), 'self'))
  // A directory alias inside a skill: both paths stay.
  writeSkill(skillDir('alias'), {
    'SKILL.md': '---\ndescription: Alias\n---\n',
    'scripts/run.sh': 'echo\n',
  })
  symlinkSync('scripts', path.join(skillDir('alias'), 'assets'))
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
  it('lists both agents’ skill folders, linked roots included, skipping no-SKILL.md', async () => {
    const skills = await listLocalSkills()

    assert.deepEqual(
      skills.map((skill) => [skill.id, skill.description, skill.fileCount]),
      [
        ['claude/alias', 'Alias', 3],
        ['claude/deploy', 'Ship the service', 3],
        ['claude/lint', 'Lint', 0],
        ['claude/loop', 'Loops', 1],
        ['claude/review', 'Review code', 2],
        ['codex/triage', 'Triage alerts', 1],
      ],
    )
  })
})

describe('localSkillEntries', () => {
  it('returns SKILL.md first, ignores node_modules, and follows only links inside the skills directory', async () => {
    assert.deepEqual(await relPaths(skillDir('deploy')), ['SKILL.md', 'guide.md', 'scripts/run.sh'])
  })

  it('walks a skill root that links into a Nix-style store, reporting where each file is', async () => {
    const entries = await localSkillEntries(skillDir('review'))

    assert.deepEqual(
      entries.map((entry) => [entry.relPath, path.relative(store, entry.realPath)]),
      [
        ['SKILL.md', path.join('aaa-review', 'SKILL.md')],
        ['refs/style.md', path.join('aaa-review', 'refs', 'style.md')],
      ],
    )
  })

  it('follows per-file links into other store paths only under a read-only root', async () => {
    assert.deepEqual(await relPaths(skillDir('lint'), [store]), ['SKILL.md'])
    assert.deepEqual(await relPaths(skillDir('lint'), []), [])
  })

  it('stops at links that point back up the tree', async () => {
    assert.deepEqual(await relPaths(skillDir('loop')), ['SKILL.md'])
  })

  it('keeps the real path of a directory that a sibling link aliases', async () => {
    assert.deepEqual(await relPaths(skillDir('alias')), [
      'SKILL.md',
      'assets/run.sh',
      'scripts/run.sh',
    ])
  })
})
