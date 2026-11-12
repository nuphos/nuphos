import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { useSkillStoreService } from '@/lib/test/doubles/skill-store-service'
import { repoTarball } from '@/lib/test/repo-tarball'

import { AppError } from '@/lib/errors'

import { discoverSkills } from './discover'
import { skillContentHash, skillFileHashes } from './origin'
import { readRepoTarball } from './tarball'
import { checkGithubSkillUpdates, updateGithubSkills } from './updates'

import type { SkillOrigin } from './origin'
import type { TarEntry } from '@/lib/test/repo-tarball'

const scope = 'teams/aaaaaaaaaaaaaaaaaaaaaaaa'
const v1 = 'a'.repeat(40)
const v2 = 'b'.repeat(40)
const skillMd = (body: string) => `---\nname: pdf\ndescription: pdf helper\n---\n\n${body}\n`
const archive = (sha: string, entries: TarEntry[]) =>
  readRepoTarball(repoTarball(entries, { commitSha: sha })) as ReturnType<
    typeof readRepoTarball
  > & {
    commitSha: string
  }
const installed = archive(v1, [
  { path: 'skills/pdf/SKILL.md', content: skillMd('one') },
  { path: 'skills/pdf/old.py', content: 'old' },
])
const upstream = archive(v2, [
  { path: 'skills/pdf/SKILL.md', content: skillMd('two') },
  { path: 'skills/pdf/new.py', content: 'new' },
])
const installedEtags = { 'skills/pdf/SKILL.md': 'e1', 'skills/pdf/old.py': 'e2' }
const files = discoverSkills(installed.files, 'skills/pdf')[0]!.files
const origin: SkillOrigin = {
  _id: `${scope}/skills/pdf`,
  scope,
  name: 'pdf',
  repo: 'o/r',
  ref: null,
  path: 'skills/pdf',
  commitSha: v1,
  contentHash: skillContentHash(files),
  fileHashes: skillFileHashes(files),
  installedEtags,
  installedAt: new Date(0),
  installedByUserId: 'u1',
}
let latest: typeof upstream | null = upstream
let stored: Record<string, string> = {}
let puts: string[][] = []
let deletes: string[] = []
let recorded: SkillOrigin[] = []
let legacyOrigin: SkillOrigin | null = null
let afterPut = () => {}
let beforePut = () => {}
let duringDownload = () => {}
const download = async () => {
  duringDownload()
  if (!latest) throw new AppError(404, 'source_not_found', 'gone')

  return latest
}

useSkillStoreService({
  skillPackageEtags: async () => ({ ...stored }),
  putSkillObjects: async (_scope, writes, _context, options) => {
    beforePut()
    // Like the store's conditional writes: refuse if anything changed since the caller's read.
    for (const write of writes)
      if (options?.expectedEtags && stored[write.key] !== options.expectedEtags[write.key])
        throw new AppError(409, 'skill_edited', `${write.key} changed`)
    puts.push(writes.map((w) => w.key))
    for (const write of writes) stored[write.key] = `new-${write.key}`
    afterPut()

    return writes.map((w) => ({ key: w.key, size: w.body.length, etag: `new-${w.key}` }))
  },
  deleteSkillObject: async (_scope, key) => {
    deletes.push(key)
    delete stored[key]
  },
})
useDb({
  db: () => ({
    collection: () => ({
      find: () => ({ toArray: async () => [legacyOrigin ?? origin] }),
      replaceOne: async (_filter: unknown, doc: SkillOrigin) => {
        recorded.push(doc)

        return { acknowledged: true }
      },
    }),
  }),
})
beforeEach(() => {
  latest = upstream
  duringDownload = () => {}
  stored = { ...installedEtags }
  puts = []
  deletes = []
  recorded = []
  legacyOrigin = null
  afterPut = () => {}
  beforePut = () => {}
})
const context = { mutationId: 'req', actor: { userId: 'u2', source: 'import' as const } }

describe('GitHub skill updates', () => {
  test('reports upstream changes since install', async () => {
    const [report] = await checkGithubSkillUpdates(scope, download)

    expect(report).toMatchObject({
      name: 'pdf',
      status: 'update_available',
      edited: false,
      installedCommit: v1,
      latestCommit: v2,
      changes: { added: ['new.py'], changed: ['SKILL.md'], removed: ['old.py'] },
      problem: null,
    })
  })

  test('reports an unchanged source, a moved folder and an edit made in Nuphos', async () => {
    latest = installed
    stored['skills/pdf/SKILL.md'] = 'edited'
    expect((await checkGithubSkillUpdates(scope, download))[0]).toMatchObject({
      status: 'up_to_date',
      edited: true,
    })
    latest = archive(v2, [{ path: 'other/pdf/SKILL.md', content: skillMd('moved') }])
    expect((await checkGithubSkillUpdates(scope, download))[0]?.status).toBe('source_missing')
  })

  test('handles an origin recorded before per-file hashes', async () => {
    const legacy: Partial<SkillOrigin> = { ...origin }

    delete legacy.fileHashes
    legacyOrigin = legacy as SkillOrigin
    expect((await checkGithubSkillUpdates(scope, download))[0]).toMatchObject({
      status: 'update_available',
      changes: { added: [], changed: ['SKILL.md', 'new.py'], removed: [] },
    })
    await updateGithubSkills(
      scope,
      { names: ['pdf'], overwriteEdited: [], commits: { pdf: v2 } },
      context,
      download,
    )
    expect(recorded[0]?.fileHashes).toBeDefined()
  })

  test('skips a skill deleted since install', async () => {
    stored = {}
    expect(await checkGithubSkillUpdates(scope, download)).toEqual([])
  })

  test('replaces the skill, removes stale files and records the new commit', async () => {
    await updateGithubSkills(
      scope,
      { names: ['pdf'], overwriteEdited: [], commits: { pdf: v2 } },
      context,
      download,
    )

    expect(puts).toEqual([['skills/pdf/SKILL.md', 'skills/pdf/new.py']])
    expect(deletes).toEqual(['skills/pdf/old.py'])
    expect(recorded[0]).toMatchObject({
      commitSha: v2,
      installedByUserId: 'u2',
      installedEtags: {
        'skills/pdf/SKILL.md': 'new-skills/pdf/SKILL.md',
        'skills/pdf/new.py': 'new-skills/pdf/new.py',
      },
    })
  })

  test('an edit saved right after the update still reads as an edit', async () => {
    afterPut = () => {
      stored['skills/pdf/SKILL.md'] = 'edited by someone else'
    }
    await updateGithubSkills(
      scope,
      { names: ['pdf'], overwriteEdited: [], commits: { pdf: v2 } },
      context,
      download,
    )

    expect(recorded[0]?.installedEtags['skills/pdf/SKILL.md']).toBe('new-skills/pdf/SKILL.md')
  })

  test('a save between the last edit check and the write fails the update instead of being replaced', async () => {
    beforePut = () => {
      stored['skills/pdf/SKILL.md'] = 'saved by someone else'
    }
    const attempt = updateGithubSkills(
      scope,
      { names: ['pdf'], overwriteEdited: [], commits: { pdf: v2 } },
      context,
      download,
    )

    await expect(attempt).rejects.toMatchObject({ code: 'skill_edited' })
    expect(stored['skills/pdf/SKILL.md']).toBe('saved by someone else')
    expect(recorded).toEqual([])
  })

  test('a stale file saved during the update is kept and reads as an edit', async () => {
    afterPut = () => {
      stored['skills/pdf/old.py'] = 'saved by someone else'
    }
    await updateGithubSkills(
      scope,
      { names: ['pdf'], overwriteEdited: [], commits: { pdf: v2 } },
      context,
      download,
    )

    expect(deletes).toEqual([])
    expect(Object.keys(recorded[0]?.installedEtags ?? {})).not.toContain('skills/pdf/old.py')
  })

  test('an edited skill needs explicit confirmation', async () => {
    stored['skills/pdf/SKILL.md'] = 'edited'
    const refused = updateGithubSkills(
      scope,
      { names: ['pdf'], overwriteEdited: [], commits: { pdf: v2 } },
      context,
      download,
    )

    await expect(refused).rejects.toMatchObject({ code: 'skill_edited' })
    expect(puts).toEqual([])
    await updateGithubSkills(
      scope,
      { names: ['pdf'], overwriteEdited: ['pdf'], commits: { pdf: v2 } },
      context,
      download,
    )
    expect(puts).toHaveLength(1)
  })

  test('reports a source that is gone without failing the whole check', async () => {
    latest = null
    expect((await checkGithubSkillUpdates(scope, download))[0]).toMatchObject({
      status: 'source_missing',
      latestCommit: null,
    })
  })

  test('refuses an update when the source moved past the reviewed commit', async () => {
    const attempt = updateGithubSkills(
      scope,
      { names: ['pdf'], overwriteEdited: [], commits: { pdf: 'c'.repeat(40) } },
      context,
      download,
    )

    await expect(attempt).rejects.toMatchObject({ code: 'source_changed' })
    expect(puts).toEqual([])
  })

  test('refuses an update when the skill is edited while it runs', async () => {
    duringDownload = () => {
      stored['skills/pdf/SKILL.md'] = 'edited meanwhile'
    }
    const attempt = updateGithubSkills(
      scope,
      { names: ['pdf'], overwriteEdited: [], commits: { pdf: v2 } },
      context,
      download,
    )

    await expect(attempt).rejects.toMatchObject({ code: 'skill_edited' })
    expect(puts).toEqual([])
  })

  test('refuses a skill with no update', async () => {
    latest = installed
    const attempt = updateGithubSkills(
      scope,
      { names: ['pdf'], overwriteEdited: [], commits: { pdf: v1 } },
      context,
      download,
    )

    await expect(attempt).rejects.toMatchObject({ code: 'no_update' })
  })
})
