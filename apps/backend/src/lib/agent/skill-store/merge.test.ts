import { mkdtempSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, test, afterEach, beforeEach } from 'bun:test'

import { useSkillStoreSync } from '@/lib/test/doubles/skill-store-sync'

import { getBuiltinSkillsDirectory } from './inject'

const isolatedCacheRoot = mkdtempSync(path.join(tmpdir(), 'merge-test-skills-'))

// tools-team-skills.e2e.test.ts stubs this same module with a different cache
// root; the shared double is what keeps the two from colliding.
useSkillStoreSync({
  getSkillsCacheRoot: () => isolatedCacheRoot,
  isSkillsStoreConfigured: () => false,
})

const { materializeMergedSkillsDir, resolveSkillsDirectory } = await import('./merge')
const { getScopeCacheDir, getScopeSyncRevision } = await import('./sync')

const TEAM_ID = '64f1a2b3c4d5e6f7a8b9c0d1'

async function writeScopeManifest(scope: string, syncedAt: string): Promise<void> {
  const dir = getScopeCacheDir(scope)

  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    path.join(dir, '.manifest.json'),
    JSON.stringify({ scope, syncedAt, objects: {} }),
    'utf8',
  )
}

async function writeCachedSkill(scope: string, name: string, body: string): Promise<void> {
  const skillDir = path.join(getScopeCacheDir(scope), 'skills', name)

  await fs.mkdir(skillDir, { recursive: true })
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), body, 'utf8')
}

async function rmMergeArtifacts(): Promise<void> {
  await fs.rm(path.join(isolatedCacheRoot, '.merged'), { recursive: true, force: true })
  await fs.rm(getScopeCacheDir(`teams/${TEAM_ID}`), { recursive: true, force: true })
  await fs.rm(getScopeCacheDir('global'), { recursive: true, force: true })
}

describe('materializeMergedSkillsDir', () => {
  afterEach(rmMergeArtifacts)

  test('legacy global and team GitHub skills cannot replace builtin credential isolation', async () => {
    for (const scope of ['global', `teams/${TEAM_ID}`]) {
      await writeScopeManifest(scope, '2026-07-06T10:00:00.000Z')
      await writeCachedSkill(scope, 'github', 'legacy login instructions')
      const scripts = path.join(getScopeCacheDir(scope), 'skills/github/scripts')

      await fs.mkdir(scripts, { recursive: true })
      await fs.writeFile(path.join(scripts, 'setup-credentials.sh'), 'gh auth login --with-token')
      await fs.writeFile(path.join(scripts, 'obsolete.sh'), 'legacy helper')
    }
    const merged = await materializeMergedSkillsDir(TEAM_ID)
    const script = 'github/scripts/setup-credentials.sh'

    expect(await fs.readFile(path.join(merged.directory, script), 'utf8')).toBe(
      await fs.readFile(path.join(getBuiltinSkillsDirectory(), script), 'utf8'),
    )
    expect(await fs.stat(path.join(merged.directory, 'github/scripts/write-auth.py'))).toBeDefined()
    expect(
      await fs.access(path.join(merged.directory, 'github/scripts/obsolete.sh')).then(
        () => true,
        () => false,
      ),
    ).toBe(false)
    expect(merged.layers.globalSkills).toBe(0)
    expect(merged.layers.teamSkills).toBe(0)

    // Existing caches used identical source revisions but different merge semantics.
    const fingerprint = path.join(merged.directory, '.merge-fingerprint')
    const old = JSON.parse(await fs.readFile(fingerprint, 'utf8'))

    delete old.version
    await fs.writeFile(fingerprint, JSON.stringify(old))
    await fs.writeFile(path.join(merged.directory, script), 'gh auth login --with-token')
    const rebuilt = await materializeMergedSkillsDir(TEAM_ID)

    expect(rebuilt.rebuilt).toBe(true)
    expect(await fs.readFile(path.join(rebuilt.directory, script), 'utf8')).toBe(
      await fs.readFile(path.join(getBuiltinSkillsDirectory(), script), 'utf8'),
    )
  })

  test('team custom skills still override global custom skills', async () => {
    await writeScopeManifest('global', '2026-07-06T10:00:00.000Z')
    await writeScopeManifest(`teams/${TEAM_ID}`, '2026-07-06T10:00:00.000Z')
    await writeCachedSkill('global', 'custom-runbook', 'global runbook')
    await writeCachedSkill(`teams/${TEAM_ID}`, 'custom-runbook', 'team runbook')
    const merged = await materializeMergedSkillsDir(TEAM_ID)

    expect(await fs.readFile(path.join(merged.directory, 'custom-runbook/SKILL.md'), 'utf8')).toBe(
      'team runbook',
    )
    expect(merged.layers.globalSkills).toBe(1)
    expect(merged.layers.teamSkills).toBe(1)
  })

  test('empty team skill dir does not shadow a global overlay', async () => {
    await writeScopeManifest('global', '2026-07-08T00:00:00.000Z')
    await writeCachedSkill('global', 'foo', 'global-foo-content')
    await writeScopeManifest(`teams/${TEAM_ID}`, '2026-07-08T01:00:00.000Z')
    // Ghost dir left when syncScope removed S3 objects but the parent dir remained.
    await fs.mkdir(path.join(getScopeCacheDir(`teams/${TEAM_ID}`), 'skills', 'foo'), {
      recursive: true,
    })

    const merged = await materializeMergedSkillsDir(TEAM_ID)
    const body = await fs.readFile(path.join(merged.directory, 'foo', 'SKILL.md'), 'utf8')

    expect(body).toBe('global-foo-content')
    expect(merged.layers.teamSkills).toBe(0)
  })

  test('reuses merged tree when fingerprint is unchanged', async () => {
    await writeScopeManifest(`teams/${TEAM_ID}`, '2026-07-06T10:00:00.000Z')
    await writeCachedSkill(`teams/${TEAM_ID}`, 'demo-skill', 'demo')

    const first = await materializeMergedSkillsDir(TEAM_ID)
    const second = await materializeMergedSkillsDir(TEAM_ID)

    expect(second.rebuilt).toBe(false)
    expect(second.directory).toBe(first.directory)
  })
})

describe('resolveSkillsDirectory', () => {
  beforeEach(rmMergeArtifacts)
  afterEach(rmMergeArtifacts)

  test('falls back to builtins when no team/global overlays exist', async () => {
    const dir = await resolveSkillsDirectory(null)

    expect(dir).toBe(getBuiltinSkillsDirectory())
    expect(await getScopeSyncRevision('global')).toBeNull()
  })

  test('returns merged directory when a global overlay exists', async () => {
    await writeScopeManifest('global', '2026-07-06T10:00:00.000Z')
    await writeCachedSkill('global', 'global-only', 'global')

    const dir = await resolveSkillsDirectory(null)

    expect(dir).not.toBe(getBuiltinSkillsDirectory())
    const body = await fs.readFile(path.join(dir, 'global-only', 'SKILL.md'), 'utf8')

    expect(body).toBe('global')
  })
})
