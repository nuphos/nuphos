import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { useSkillStoreService } from '@/lib/test/doubles/skill-store-service'
import { repoTarball } from '@/lib/test/repo-tarball'

import { CLAIM_TTL_MS } from './claims'
import { installGithubSkills, previewGithubSkills } from './install'
import { readRepoTarball } from './tarball'

import type { SkillObjectWrite } from '@/lib/agent/skill-store/service'

const sha = 'c'.repeat(40)
const scope = 'teams/aaaaaaaaaaaaaaaaaaaaaaaa'
const skillMd = (name: string) =>
  `---\nname: ${name}\ndescription: ${name} helper\n---\n\nUse it.\n`
const fixture = repoTarball(
  [
    { path: 'skills/pdf/SKILL.md', content: skillMd('pdf') },
    { path: 'skills/pdf/scripts/fill.py', content: 'print("fill")\n' },
    { path: 'skills/pdf/link', type: '2', link: '../../etc' },
    { path: 'skills/leaky/SKILL.md', content: skillMd('leaky') },
    { path: 'skills/leaky/.env', content: 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLF\n' },
    { path: 'skills/kubectl/SKILL.md', content: skillMd('kubectl') },
    { path: 'skills/existing/SKILL.md', content: skillMd('existing') },
    { path: 'skills/bad/SKILL.md', content: skillMd('bad name') },
  ],
  { commitSha: sha },
)
const download = async (_source: unknown, ref: string | null) => {
  refs.push(ref)

  return readRepoTarball(fixture) as ReturnType<typeof readRepoTarball> & { commitSha: string }
}
let refs: (string | null)[] = []
let writes: SkillObjectWrite[][] = []
let origins: Record<string, unknown>[] = []
let stored = new Set<string>()
let truncated = false
let listed = ['existing']
let claims = new Map<string, { mutationId: string; claimedAt: Date }>()
let applied = new Set<string>()
let writeGate: Promise<void> = Promise.resolve()

useSkillStoreService({
  listBuiltinSkillNames: async () => ['kubectl'],
  getSkillManifest: async () => ({
    scope,
    skills: listed.map((name) => ({ name })),
    orphans: [],
    truncated,
    limit: 5000,
  }),
  skillPackageExists: async (_scope, name) => stored.has(name),
  putSkillObjects: async (_scope, batch) => {
    await writeGate
    writes.push(batch)

    return batch.map((write) => ({
      key: write.key,
      size: write.body.length,
      etag: `etag-${write.key}`,
    }))
  },
})
type ClaimFilter = {
  _id: string
  mutationId?: string
  $or?: [{ mutationId: string }, { claimedAt: { $lt: Date } }]
}
const claimCollection = {
  insertOne: async (doc: { _id: string; mutationId: string; claimedAt: Date }) => {
    if (claims.has(doc._id)) throw Object.assign(new Error('duplicate key'), { code: 11000 })
    claims.set(doc._id, doc)
  },
  findOneAndReplace: async (filter: ClaimFilter, doc: { mutationId: string; claimedAt: Date }) => {
    const held = claims.get(filter._id)
    const [mine, stale] = filter.$or ?? []

    if (!held || (held.mutationId !== mine?.mutationId && held.claimedAt >= stale!.claimedAt.$lt))
      return null
    claims.set(filter._id, doc)

    return held
  },
  deleteOne: async (filter: ClaimFilter) => {
    if (claims.get(filter._id)?.mutationId === filter.mutationId) claims.delete(filter._id)
  },
}

useDb({
  db: () => ({
    collection: (name: string) => {
      if (name === 'skill_events')
        return {
          findOne: async ({ mutationId }: { mutationId: string }) =>
            applied.has(mutationId) ? { status: 'applied' } : null,
        }
      if (name === 'skill_name_claims') return claimCollection

      return {
        replaceOne: async (filter: Record<string, unknown>, doc: Record<string, unknown>) => {
          origins.push({ ...filter, ...doc })

          return { acknowledged: true }
        },
      }
    },
  }),
})
beforeEach(() => {
  refs = []
  writes = []
  origins = []
  stored = new Set()
  truncated = false
  listed = ['existing']
  claims = new Map()
  applied = new Set()
  writeGate = Promise.resolve()
})
const context = { mutationId: 'req-1', actor: { userId: 'u1', source: 'import' as const } }

describe('GitHub skill install', () => {
  test('preview lists every skill with what blocks it', async () => {
    const preview = await previewGithubSkills(
      scope,
      'https://github.com/o/r/tree/main/skills',
      download,
    )

    expect(refs).toEqual(['main'])
    expect(preview).toMatchObject({ repo: 'o/r', ref: 'main', subpath: 'skills', commitSha: sha })
    expect(preview.skills.map((s) => [s.name, s.problem?.code ?? null])).toEqual([
      ['bad name', 'invalid_name'],
      ['existing', 'exists'],
      ['kubectl', 'reserved_name'],
      ['leaky', 'secret'],
      ['pdf', null],
    ])
    expect(preview.skills.at(-1)).toMatchObject({ fileCount: 2, skipped: ['link'] })
  })

  test('install writes the skill at the previewed commit and records its origin', async () => {
    const installed = await installGithubSkills(
      scope,
      { source: 'o/r', commitSha: sha, names: ['pdf'] },
      context,
      download,
    )

    expect(refs).toEqual([sha])
    expect(installed.map((s) => s.name)).toEqual(['pdf'])
    expect(writes[0]!.map((w) => w.key)).toEqual([
      'skills/pdf/SKILL.md',
      'skills/pdf/scripts/fill.py',
    ])
    expect(origins[0]).toMatchObject({
      _id: `${scope}/skills/pdf`,
      repo: 'o/r',
      ref: null,
      path: 'skills/pdf',
      commitSha: sha,
      installedEtags: { 'skills/pdf/SKILL.md': 'etag-skills/pdf/SKILL.md' },
    })
  })

  test('install refuses a blocked skill before writing anything', async () => {
    const attempt = installGithubSkills(
      scope,
      { source: 'o/r', commitSha: sha, names: ['pdf', 'leaky'] },
      context,
      download,
    )

    await expect(attempt).rejects.toMatchObject({ code: 'skill_not_installable' })
    expect(writes).toEqual([])
  })

  test('a truncated manifest falls back to looking each skill up', async () => {
    truncated = true
    stored = new Set(['pdf'])
    const preview = await previewGithubSkills(scope, 'o/r', download)

    expect(preview.skills.find((s) => s.name === 'pdf')?.problem?.code).toBe('exists')
  })

  test('install refuses a name stored since the preview', async () => {
    stored = new Set(['pdf'])
    const attempt = installGithubSkills(
      scope,
      { source: 'o/r', commitSha: sha, names: ['pdf'] },
      context,
      download,
    )

    await expect(attempt).rejects.toMatchObject({ code: 'skill_exists' })
    expect(writes).toEqual([])
  })

  test('two concurrent installs of one name cannot both write it', async () => {
    let open = () => {}

    writeGate = new Promise((resolve) => {
      open = resolve
    })
    const input = { source: 'o/r', commitSha: sha, names: ['pdf'] }
    const first = installGithubSkills(scope, input, context, download)
    const second = installGithubSkills(scope, input, { ...context, mutationId: 'req-2' }, download)
    const settled = Promise.allSettled([first, second])

    await new Promise((resolve) => setTimeout(resolve, 10))
    open()
    const [a, b] = await settled

    expect(new Set([a.status, b.status])).toEqual(new Set(['fulfilled', 'rejected']))
    expect((a.status === 'rejected' ? a : b) as PromiseRejectedResult).toMatchObject({
      reason: { code: 'skill_exists' },
    })
    expect(writes).toHaveLength(1)
    expect(claims.size).toBe(0)
  })

  test('takes over a claim left by a request that died', async () => {
    claims.set(`${scope}/skills/pdf`, {
      mutationId: 'gone',
      claimedAt: new Date(Date.now() - CLAIM_TTL_MS - 1000),
    })
    await installGithubSkills(
      scope,
      { source: 'o/r', commitSha: sha, names: ['pdf'] },
      context,
      download,
    )

    expect(writes).toHaveLength(1)
    expect(claims.size).toBe(0)
  })

  test('a retried request returns the completed install instead of a conflict', async () => {
    listed = ['existing', 'pdf']
    stored = new Set(['pdf'])
    applied = new Set(['req-1:pdf'])
    const installed = await installGithubSkills(
      scope,
      { source: 'o/r', commitSha: sha, names: ['pdf'] },
      context,
      download,
    )

    expect(installed.map((s) => s.name)).toEqual(['pdf'])
    expect(writes).toHaveLength(1)
  })

  test('another request still gets a conflict for that name', async () => {
    listed = ['existing', 'pdf']
    stored = new Set(['pdf'])
    applied = new Set(['req-1:pdf'])
    const attempt = installGithubSkills(
      scope,
      { source: 'o/r', commitSha: sha, names: ['pdf'] },
      { ...context, mutationId: 'req-2' },
      download,
    )

    await expect(attempt).rejects.toMatchObject({ code: 'skill_not_installable' })
    expect(writes).toEqual([])
  })

  test('install refuses an archive from another commit', async () => {
    const attempt = installGithubSkills(
      scope,
      { source: 'o/r', commitSha: 'd'.repeat(40), names: ['pdf'] },
      context,
      download,
    )

    await expect(attempt).rejects.toMatchObject({ code: 'source_changed' })
  })
})
