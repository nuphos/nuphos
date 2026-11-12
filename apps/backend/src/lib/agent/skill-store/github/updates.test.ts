import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { useSkillStoreService } from '@/lib/test/doubles/skill-store-service'
import { repoTarball } from '@/lib/test/repo-tarball'

import { AppError } from '@/lib/errors'

import { discoverSkills } from './discover'
import { getSkillOriginDTO, skillContentHash, skillFileHashes } from './origin'
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
let createdAt: Date | null = null
/** Applied mutation results by ID, with the ETags each write left. */
let applied = new Map<string, Record<string, string>>()
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
    collection: (name: string) => ({
      // skill_records: the package's lifecycle; skill_events: completed mutations.
      findOne: async (filter: { mutationId?: string; _id?: string }) => {
        if (name === 'skill_records') return createdAt ? { createdAt } : null
        const afterEtags = filter.mutationId && applied.get(filter.mutationId)

        if (name === 'skill_events') return afterEtags ? { status: 'applied', afterEtags } : null

        return legacyOrigin ?? origin
      },
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
  createdAt = null
  applied = new Map()
  beforePut = () => {}
})
const context = { mutationId: 'req', actor: { userId: 'u2', source: 'import' as const } }
const apply = (input: { overwriteEdited?: string[]; commits?: Record<string, string> } = {}) =>
  updateGithubSkills(
    scope,
    { names: ['pdf'], overwriteEdited: [], commits: { pdf: v2 }, ...input },
    context,
    download,
  )

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
    await apply()
    expect(recorded[0]?.fileHashes).toBeDefined()
  })

  test('skips a skill deleted since install', async () => {
    stored = {}
    expect(await checkGithubSkillUpdates(scope, download)).toEqual([])
  })

  test('replaces the skill, removes stale files and records the new commit', async () => {
    await apply()

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
    await apply()

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
    const refused = apply()

    await expect(refused).rejects.toMatchObject({ code: 'skill_edited' })
    expect(puts).toEqual([])
    await apply({ overwriteEdited: ['pdf'] })
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
    const attempt = apply({ commits: { pdf: 'c'.repeat(40) } })

    await expect(attempt).rejects.toMatchObject({ code: 'source_changed' })
    expect(puts).toEqual([])
  })

  test('refuses an update when the skill is edited while it runs', async () => {
    duringDownload = () => {
      stored['skills/pdf/SKILL.md'] = 'edited meanwhile'
    }
    const attempt = apply()

    await expect(attempt).rejects.toMatchObject({ code: 'skill_edited' })
    expect(puts).toEqual([])
  })

  test('a retried update that already completed returns its report instead of no_update', async () => {
    latest = installed
    applied = new Map([['req:pdf:put', { ...stored }]])
    const updated = await apply({ commits: { pdf: v1 } })

    expect(updated.map((u) => u.name)).toEqual(['pdf'])
    expect(puts).toEqual([])
  })

  test('a retry after the write but before cleanup finishes the update', async () => {
    // The first attempt wrote the new files, then failed before removing old.py and saving the origin.
    stored = {
      'skills/pdf/SKILL.md': 'new-skills/pdf/SKILL.md',
      'skills/pdf/new.py': 'new-skills/pdf/new.py',
      'skills/pdf/old.py': 'e2',
    }
    applied = new Map([['req:pdf:put', { ...stored }]])
    await apply()

    expect(deletes).toEqual(['skills/pdf/old.py'])
    expect(recorded[0]).toMatchObject({ commitSha: v2 })
  })

  test('a retry does not resume over a file added after the first write', async () => {
    stored = {
      'skills/pdf/SKILL.md': 'new-skills/pdf/SKILL.md',
      'skills/pdf/new.py': 'new-skills/pdf/new.py',
    }
    applied = new Map([['req:pdf:put', { ...stored }]])
    stored['skills/pdf/custom.py'] = 'added by someone else'
    const input = { names: ['pdf'], overwriteEdited: [] as string[], commits: { pdf: v2 } }

    await expect(updateGithubSkills(scope, input, context, download)).rejects.toMatchObject({
      code: 'skill_edited',
    })
    expect(deletes).toEqual([])
    await updateGithubSkills(scope, { ...input, overwriteEdited: ['pdf'] }, context, download)
    expect(deletes).toEqual(['skills/pdf/custom.py'])
  })

  test('ignores an origin from before the skill was deleted and created again', async () => {
    createdAt = new Date(origin.installedAt.getTime() + 1000)
    expect(await checkGithubSkillUpdates(scope, download)).toEqual([])
    expect(await getSkillOriginDTO(scope, 'pdf')).toBeNull()
    createdAt = new Date(origin.installedAt.getTime() - 1000)
    expect((await checkGithubSkillUpdates(scope, download)).map((u) => u.name)).toEqual(['pdf'])
    expect(await getSkillOriginDTO(scope, 'pdf')).toMatchObject({ repo: 'o/r', path: 'skills/pdf' })
  })

  test('refuses a skill with no update', async () => {
    latest = installed
    const attempt = apply({ commits: { pdf: v1 } })

    await expect(attempt).rejects.toMatchObject({ code: 'no_update' })
  })
})
