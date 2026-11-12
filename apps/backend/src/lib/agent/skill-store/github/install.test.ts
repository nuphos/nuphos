import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { useSkillStoreService } from '@/lib/test/doubles/skill-store-service'
import { repoTarball } from '@/lib/test/repo-tarball'

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

useSkillStoreService({
  listBuiltinSkillNames: async () => ['kubectl'],
  getSkillManifest: async () => ({
    scope,
    skills: [{ name: 'existing' }],
    orphans: [],
    truncated: false,
    limit: 5000,
  }),
  putSkillObjects: async (_scope, batch) => {
    writes.push(batch)

    return batch.map((write) => ({
      key: write.key,
      size: write.body.length,
      etag: `etag-${write.key}`,
    }))
  },
})
useDb({
  db: () => ({
    collection: () => ({
      replaceOne: async (filter: Record<string, unknown>, doc: Record<string, unknown>) => {
        origins.push({ ...filter, ...doc })

        return { acknowledged: true }
      },
    }),
  }),
})
beforeEach(() => {
  refs = []
  writes = []
  origins = []
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
