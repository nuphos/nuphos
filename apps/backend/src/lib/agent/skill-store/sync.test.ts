import { mkdtempSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, test } from 'bun:test'

import { getScopeCacheDir, pruneInvalidCachedSkillDirs } from './sync'

describe('getScopeCacheDir', () => {
  test('nests scope segments under cache root', () => {
    const dir = getScopeCacheDir('teams/abc123')

    expect(dir.endsWith(path.join('teams', 'abc123'))).toBe(true)
    expect(dir).not.toContain('..')
  })
})

describe('pruneInvalidCachedSkillDirs', () => {
  test('removes completely empty ghost skill dirs', async () => {
    const scopeDir = mkdtempSync(path.join(tmpdir(), 'prune-skills-'))
    const validDir = path.join(scopeDir, 'skills', 'valid-skill')
    const ghostDir = path.join(scopeDir, 'skills', 'ghost-skill')

    await fs.mkdir(validDir, { recursive: true })
    await fs.mkdir(ghostDir, { recursive: true })
    await fs.writeFile(path.join(validDir, 'SKILL.md'), '# valid', 'utf8')

    const pruned = await pruneInvalidCachedSkillDirs(scopeDir)

    expect(pruned).toBe(1)
    await expect(fs.stat(ghostDir)).rejects.toThrow()
    const body = await fs.readFile(path.join(validDir, 'SKILL.md'), 'utf8')

    expect(body).toBe('# valid')
  })

  test('keeps skill dirs that have files but no SKILL.md yet', async () => {
    const scopeDir = mkdtempSync(path.join(tmpdir(), 'prune-skills-'))
    const partialDir = path.join(scopeDir, 'skills', 'in-progress')

    await fs.mkdir(path.join(partialDir, 'scripts'), { recursive: true })
    await fs.writeFile(path.join(partialDir, 'scripts', 'run.sh'), '#!/bin/sh', 'utf8')

    const pruned = await pruneInvalidCachedSkillDirs(scopeDir)

    expect(pruned).toBe(0)
    const script = await fs.readFile(path.join(partialDir, 'scripts', 'run.sh'), 'utf8')

    expect(script).toBe('#!/bin/sh')
  })

  test('removes dirs that only contain empty nested folders', async () => {
    const scopeDir = mkdtempSync(path.join(tmpdir(), 'prune-skills-'))
    const ghostDir = path.join(scopeDir, 'skills', 'ghost-nested')

    await fs.mkdir(path.join(ghostDir, 'scripts'), { recursive: true })

    const pruned = await pruneInvalidCachedSkillDirs(scopeDir)

    expect(pruned).toBe(1)
    await expect(fs.stat(ghostDir)).rejects.toThrow()
  })
})
