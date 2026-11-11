import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

import {
  listLocalSkills,
  localSkillEntries,
  matchesReview,
  readSkillFile,
  skillDescription,
} from './local-skills.ts'

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

async function relPaths(root: string) {
  return (await localSkillEntries(root)).map((entry) => entry.relPath)
}

before(() => {
  home = mkdtempSync(path.join(os.tmpdir(), 'local-skills-'))
  outside = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'outside-')))
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
  // Links out of the skill, to a file, a directory and nowhere: followed like `cp -L`.
  symlinkSync(path.join(outside, 'secret.txt'), path.join(skillDir('deploy'), 'secret.txt'))
  symlinkSync(outside, path.join(skillDir('deploy'), 'elsewhere'))
  symlinkSync(path.join(outside, 'missing'), path.join(skillDir('deploy'), 'dangling'))
  // A link to a file elsewhere inside the skills directory, as gstack installs its skills.
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
  // Directory aliases inside a skill, sorting before and after their target: all paths stay.
  writeSkill(skillDir('alias'), {
    'SKILL.md': '---\ndescription: Alias\n---\n',
    'scripts/run.sh': 'echo\n',
  })
  symlinkSync('scripts', path.join(skillDir('alias'), 'assets'))
  symlinkSync('scripts', path.join(skillDir('alias'), 'tools'))
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
      skills.map((skill) => [skill.id, skill.description, skill.fileCount, skill.linkedTo]),
      [
        ['claude/alias', 'Alias', 4, null],
        ['claude/deploy', 'Ship the service', 6, null],
        ['claude/lint', 'Lint', 1, path.join(store, 'ccc-skills', 'lint')],
        ['claude/loop', 'Loops', 1, null],
        ['claude/review', 'Review code', 2, path.join(store, 'aaa-review')],
        ['codex/triage', 'Triage alerts', 1, null],
      ],
    )
  })

  it('marks each file a link brings in from outside the skill’s resolved folder', async () => {
    const skills = new Map((await listLocalSkills()).map((skill) => [skill.id, skill]))
    const outsideOf = (id: string) =>
      skills
        .get(id)
        ?.files.filter((file) => file.outside)
        .map((file) => [file.relPath, file.realPath])

    assert.deepEqual(outsideOf('claude/deploy'), [
      ['elsewhere/secret.txt', path.join(outside, 'secret.txt')],
      ['elsewhere/SKILL.md', path.join(outside, 'SKILL.md')],
      ['guide.md', path.join(realpathSync(skillDir('shared')), 'guide.md')],
      ['secret.txt', path.join(outside, 'secret.txt')],
    ])
    // A linked root is the skill's own folder; symlinkJoin's per-file links are not.
    assert.deepEqual(outsideOf('claude/review'), [])
    assert.deepEqual(outsideOf('claude/lint'), [
      ['SKILL.md', path.join(store, 'bbb-lint', 'SKILL.md')],
    ])
  })
})

describe('localSkillEntries', () => {
  it('returns SKILL.md first, ignores node_modules, follows links anywhere and drops dangling ones', async () => {
    assert.deepEqual(await relPaths(skillDir('deploy')), [
      'SKILL.md',
      'elsewhere/secret.txt',
      'elsewhere/SKILL.md',
      'guide.md',
      'scripts/run.sh',
      'secret.txt',
    ])
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

  it('stops at links that point back up the tree', async () => {
    assert.deepEqual(await relPaths(skillDir('loop')), ['SKILL.md'])
  })

  it('keeps the real path of a directory that sibling links alias', async () => {
    assert.deepEqual(await relPaths(skillDir('alias')), [
      'SKILL.md',
      'assets/run.sh',
      'scripts/run.sh',
      'tools/run.sh',
    ])
  })
})

describe('localSkillEntries fan-out', () => {
  it('bounds the work when directory aliases branch', { timeout: 10_000 }, async () => {
    const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'fan-out-')))

    writeSkill(root, { 'SKILL.md': 'x' })
    // Ten levels, each linking to the next ten times: 10^6 paths without a cap.
    for (let level = 0; level < 10; level += 1) {
      mkdirSync(path.join(root, `d${String(level)}`))
      for (let link = 0; link < 10; link += 1) {
        symlinkSync(
          path.join(root, `d${String(level + 1)}`),
          path.join(root, `d${String(level)}`, `l${String(link)}`),
        )
      }
    }
    mkdirSync(path.join(root, 'd10'))
    for (let link = 0; link < 10; link += 1) {
      symlinkSync(path.join(root, 'd0'), path.join(root, `l${String(link)}`))
    }

    assert.deepEqual(await relPaths(root), ['SKILL.md'])
  })
})

describe('matchesReview', () => {
  it('holds only for the same files at the same real paths', () => {
    const skillMd = { relPath: 'SKILL.md', realPath: '/s/SKILL.md' }
    const reviewed = [skillMd, { relPath: 'ref.md', realPath: '/s/ref.md' }]

    assert.ok(matchesReview(reviewed.toReversed(), reviewed))
    assert.ok(!matchesReview([skillMd, { relPath: 'ref.md', realPath: '/home/.ssh/id' }], reviewed))
    assert.ok(!matchesReview([...reviewed, { relPath: 'new.md', realPath: '/s/new.md' }], reviewed))
    assert.ok(!matchesReview([skillMd], reviewed))
  })
})

describe('readSkillFile', () => {
  it('reads the walked file, and refuses one swapped for a link or another file', async () => {
    const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'read-skill-')))

    writeSkill(root, { 'SKILL.md': 'mine', 'other.md': 'other' })
    const [entry] = await localSkillEntries(root)

    assert.ok(entry)
    assert.equal((await readSkillFile(entry)).toString(), 'mine')
    renameSync(path.join(root, 'other.md'), entry.realPath)
    await assert.rejects(readSkillFile(entry), /changed while it was being read/)
    unlinkSync(entry.realPath)
    symlinkSync(path.join(outside, 'secret.txt'), entry.realPath)
    await assert.rejects(readSkillFile(entry))
  })
})
