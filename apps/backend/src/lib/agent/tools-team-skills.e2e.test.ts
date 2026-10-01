import { createHash } from 'node:crypto'
import { mkdtempSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { byCodeUnit } from '@/lib/agent/sort-order'
import { AppError } from '@/lib/errors'
import * as identity from '@/lib/identity'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useSkillStoreMetadata } from '@/lib/test/doubles/skill-store-metadata'
import { useSkillStoreService } from '@/lib/test/doubles/skill-store-service'
import { useSkillStoreSync } from '@/lib/test/doubles/skill-store-sync'

import type { NuphosTeamRole } from '@/lib/identity'

const e2eCacheRoot = mkdtempSync(path.join(tmpdir(), 'e2e-skills-test-'))

const TEAM_ID = '64f1a2b3c4d5e6f7a8b9c0d1'
const EDITOR_USER = 'editor-user-1'
const VIEWER_USER = 'viewer-user-1'

type StoredS3Object = {
  body: Buffer
  etag: string
  contentType: string | null
  lastModified: Date
}

const s3Store = new Map<string, StoredS3Object>()
const mutationResults = new Map<string, { status: 'applied'; changedKeys: string[] }>()

function etagFor(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex')
}

const fakeS3Client = {
  bucket: 'e2e-skills-bucket',
  async listCommonPrefixes(): Promise<string[]> {
    return []
  },
  async listUnderPrefix(prefix: string) {
    const objects = []

    for (const [key, obj] of s3Store) {
      if (key.startsWith(prefix)) {
        objects.push({
          key,
          etag: obj.etag,
          size: obj.body.byteLength,
          lastModified: obj.lastModified,
        })
      }
    }

    return objects.sort((a, b) => a.key.localeCompare(b.key))
  },
  async getObjectBody(key: string): Promise<Buffer> {
    const obj = s3Store.get(key)

    if (!obj) {
      throw new AppError(404, 'skill_object_not_found', `S3 object not found: ${key}`)
    }

    return obj.body
  },
  async headObject(key: string) {
    const obj = s3Store.get(key)

    if (!obj) return null

    return {
      size: obj.body.byteLength,
      etag: obj.etag,
      contentType: obj.contentType,
      lastModified: obj.lastModified,
    }
  },
  async putObject(key: string, body: Buffer, contentType?: string | null): Promise<string> {
    const etag = etagFor(body)

    s3Store.set(key, {
      body,
      etag,
      contentType: contentType ?? null,
      lastModified: new Date(),
    })

    return etag
  },
  async deleteObject(key: string): Promise<void> {
    s3Store.delete(key)
  },
  async presignDownload(key: string): Promise<string> {
    return `https://e2e-skills.test/${encodeURIComponent(key)}`
  },
}

let membershipRole: NuphosTeamRole | null = 'EDITOR'

useIdentity({
  getTeamMembership: async (_userId: string, _teamId: string) => {
    if (!membershipRole) return null

    return {
      role: membershipRole,
      team: { id: TEAM_ID, name: 'E2E Team' },
    }
  },
})

// Match the relative specifiers used by the production modules. Bun 1.3.14
// keeps module mocks in the process-wide cache and does not consistently
// coalesce a tsconfig alias with a relative import during a full-suite run.
await mock.module('./skill-store/skills-s3', () => ({
  SkillsS3Client: {
    fromConfig: () => fakeS3Client,
  },
  getSkillsStore: () => fakeS3Client,
  isSkillsS3Configured: () => true,
}))

useSkillStoreMetadata({
  listSkillRecords: async () => [],
  getSkillRecord: async () => null,
  listSkillMutationEvents: async () => [],
  skillMetadataRepository: () => ({
    getResult: async (mutationId: string) => mutationResults.get(mutationId) ?? null,
    begin: async () => undefined,
    complete: async (input: { mutationId: string; changedKeys: string[] }) => {
      mutationResults.set(input.mutationId, {
        status: 'applied',
        changedKeys: input.changedKeys,
      })

      return undefined
    },
    fail: async () => undefined,
  }),
})

useSkillStoreService({
  isSkillsStoreConfigured: () => true,
})

// merge.test.ts stubs this same module with its own cache root.
useSkillStoreSync({
  getSkillsCacheRoot: () => e2eCacheRoot,
  isSkillsStoreConfigured: () => true,
})

const { createTeamSkillTools } = await import('./tools-team-skills')
const { deleteSkillByName, getSkillManifest, putSkillObject } =
  await import('./skill-store/service')
const { materializeMergedSkillsDir, resolveSkillsDirectory } = await import('./skill-store/merge')
const { getScopeCacheDir } = await import('./skill-store/sync')

type ExecutableTool = {
  execute: (input: Record<string, unknown>, opts: { toolCallId: string }) => Promise<unknown>
}

async function execTool(
  tool: ExecutableTool,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return (await tool.execute(input, { toolCallId: 'e2e-call-1' })) as Record<string, unknown>
}

function requireTeamSkillTools(tools: Awaited<ReturnType<typeof createTeamSkillTools>>): {
  skill_create: ExecutableTool
  skill_upsert: ExecutableTool
} {
  if (!('skill_create' in tools) || !('skill_upsert' in tools)) {
    throw new Error('expected team skill tools to be enabled')
  }

  return tools as unknown as { skill_create: ExecutableTool; skill_upsert: ExecutableTool }
}

async function rmTeamSkillArtifacts(): Promise<void> {
  await fs.rm(path.join(e2eCacheRoot, '.merged'), { recursive: true, force: true })
  await fs.rm(getScopeCacheDir(`teams/${TEAM_ID}`), { recursive: true, force: true })
}

beforeEach(async () => {
  s3Store.clear()
  mutationResults.clear()
  membershipRole = 'EDITOR'
  await rmTeamSkillArtifacts()
})

afterEach(rmTeamSkillArtifacts)

describe('team skill tools E2E', () => {
  test('skill_create → manifest → merged cache simulates next-turn skill() load', async () => {
    const { skill_create } = requireTeamSkillTools(
      await createTeamSkillTools(EDITOR_USER, TEAM_ID, 'user'),
    )

    const created = await execTool(skill_create, {
      label: 'Create deploy checklist',
      name: 'deploy-checklist',
      description: 'Zeabur deploy steps',
      body: '# Deploy\n\n1. Push image',
      files: [{ path: 'references/notes.md', content: 'Keep staging green.' }],
    })

    expect(created.ok).toBe(true)
    expect(created.name).toBe('deploy-checklist')
    expect(created.files).toEqual([
      'skills/deploy-checklist/SKILL.md',
      'skills/deploy-checklist/references/notes.md',
    ])

    const manifest = await getSkillManifest(`teams/${TEAM_ID}`)
    const summary = manifest.skills.find((skill) => skill.name === 'deploy-checklist')

    expect(summary?.description).toBe('Zeabur deploy steps')
    expect(summary?.hasSkillMd).toBe(true)
    expect(summary?.fileCount).toBe(2)

    const merged = await materializeMergedSkillsDir(TEAM_ID)

    expect(merged.skillNames).toContain('deploy-checklist')
    expect(merged.layers.teamSkills).toBe(1)

    const skillMd = await fs.readFile(
      path.join(merged.directory, 'deploy-checklist', 'SKILL.md'),
      'utf8',
    )

    expect(skillMd).toContain('Zeabur deploy steps')
    expect(skillMd).toContain('# Deploy')

    const skillsDir = await resolveSkillsDirectory(TEAM_ID)
    const notes = await fs.readFile(
      path.join(skillsDir, 'deploy-checklist', 'references', 'notes.md'),
      'utf8',
    )

    expect(notes).toBe('Keep staging green.')
  })

  test('skill_upsert revises an existing team skill for the next turn', async () => {
    const { skill_create, skill_upsert } = requireTeamSkillTools(
      await createTeamSkillTools(EDITOR_USER, TEAM_ID, 'user'),
    )

    await execTool(skill_create, {
      label: 'Seed incident runbook',
      name: 'incident-runbook',
      description: 'First draft',
      body: '# Incident\n\nPage on-call.',
    })

    const upserted = await execTool(skill_upsert, {
      label: 'Revise incident runbook',
      files: [
        {
          key: 'skills/incident-runbook/SKILL.md',
          content: `---
name: incident-runbook
description: Updated on-call playbook
---

# Incident

1. Acknowledge in Slack.
`,
        },
      ],
    })

    expect(upserted.ok).toBe(true)

    const manifest = await getSkillManifest(`teams/${TEAM_ID}`)

    expect(manifest.skills.find((skill) => skill.name === 'incident-runbook')?.description).toBe(
      'Updated on-call playbook',
    )

    const merged = await materializeMergedSkillsDir(TEAM_ID)
    const skillMd = await fs.readFile(
      path.join(merged.directory, 'incident-runbook', 'SKILL.md'),
      'utf8',
    )

    expect(skillMd).toContain('Acknowledge in Slack')
  })

  test('VIEWER does not receive team skill tools', async () => {
    membershipRole = 'VIEWER'
    expect(await createTeamSkillTools(VIEWER_USER, TEAM_ID, 'user')).toEqual({})
  })

  test('trigger sessions do not receive team skill tools', async () => {
    expect(await createTeamSkillTools(EDITOR_USER, TEAM_ID, 'trigger')).toEqual({})
  })

  test('skill_create rejects duplicates and embedded secrets', async () => {
    const { skill_create } = requireTeamSkillTools(
      await createTeamSkillTools(EDITOR_USER, TEAM_ID, 'user'),
    )

    await execTool(skill_create, {
      label: 'Create once',
      name: 'dup-skill',
      description: 'Original',
      body: '# Original',
    })

    const duplicate = await execTool(skill_create, {
      label: 'Create again',
      name: 'dup-skill',
      description: 'Duplicate',
      body: '# Duplicate',
    })

    expect(duplicate.ok).toBe(false)
    expect(duplicate.error).toContain('skill_already_exists')

    const secret = await execTool(skill_create, {
      label: 'Leak secret',
      name: 'secret-skill',
      description: 'Bad',
      body: 'token sk-abcdefghijklmnopqrstuvwxyz123456',
    })

    expect(secret.ok).toBe(false)
    expect(secret.error).toContain('unsafe_content')
  })

  test('skill_create rolls back SKILL.md when a later S3 write fails', async () => {
    const { skill_create } = requireTeamSkillTools(
      await createTeamSkillTools(EDITOR_USER, TEAM_ID, 'user'),
    )

    let putCount = 0
    const originalPut = fakeS3Client.putObject.bind(fakeS3Client)

    fakeS3Client.putObject = async (key, body, contentType) => {
      putCount += 1
      if (putCount > 1) {
        throw new Error('simulated S3 failure')
      }

      return originalPut(key, body, contentType)
    }

    try {
      await expect(
        execTool(skill_create, {
          label: 'S3 rollback guard',
          name: 'rollback-guard-skill',
          description: 'Should not land',
          body: '# Partial',
          files: [{ path: 'notes.md', content: 'never saved' }],
        }),
      ).rejects.toThrow('simulated S3 failure')

      const manifest = await getSkillManifest(`teams/${TEAM_ID}`)

      expect(manifest.skills.some((skill) => skill.name === 'rollback-guard-skill')).toBe(false)
      expect([...s3Store.keys()].some((key) => key.includes('rollback-guard-skill'))).toBe(false)
    } finally {
      fakeS3Client.putObject = originalPut
    }
  })

  test('skill_upsert restores pre-existing files on partial S3 failure', async () => {
    const { skill_create, skill_upsert } = requireTeamSkillTools(
      await createTeamSkillTools(EDITOR_USER, TEAM_ID, 'user'),
    )

    await execTool(skill_create, {
      label: 'Seed upsert rollback skill',
      name: 'upsert-rollback-skill',
      description: 'Original draft',
      body: '# Original\n\nKeep this text.',
    })

    const skillMdKey = `teams/${TEAM_ID}/skills/upsert-rollback-skill/SKILL.md`
    const notesKey = `teams/${TEAM_ID}/skills/upsert-rollback-skill/notes.md`
    const originalBody = s3Store.get(skillMdKey)?.body.toString('utf8')

    expect(originalBody).toContain('Keep this text.')

    const originalPut = fakeS3Client.putObject.bind(fakeS3Client)

    fakeS3Client.putObject = async (key, body, contentType) => {
      if (key.endsWith('/notes.md')) {
        throw new Error('simulated S3 failure')
      }

      return originalPut(key, body, contentType)
    }

    try {
      await expect(
        execTool(skill_upsert, {
          label: 'Partial upsert',
          files: [
            {
              key: 'skills/upsert-rollback-skill/SKILL.md',
              content: '# Overwritten\n\nShould rollback.',
            },
            { key: 'skills/upsert-rollback-skill/notes.md', content: 'never lands' },
          ],
        }),
      ).rejects.toThrow('simulated S3 failure')

      expect(s3Store.get(skillMdKey)?.body.toString('utf8')).toBe(originalBody)
      expect(s3Store.has(notesKey)).toBe(false)
    } finally {
      fakeS3Client.putObject = originalPut
    }
  })

  test('skill_create rejects builtin skill names', async () => {
    const { skill_create } = requireTeamSkillTools(
      await createTeamSkillTools(EDITOR_USER, TEAM_ID, 'user'),
    )

    const blocked = await execTool(skill_create, {
      label: 'Overlay aws',
      name: 'aws',
      description: 'Malicious overlay',
      body: '# Steal creds',
    })

    expect(blocked.ok).toBe(false)
    expect(blocked.error).toContain('reserved_skill_name')

    const manifest = await getSkillManifest(`teams/${TEAM_ID}`)

    expect(manifest.skills.some((skill) => skill.name === 'aws')).toBe(false)
  })

  test('skill_create does not persist a partial skill when a later file fails validation', async () => {
    const { skill_create } = requireTeamSkillTools(
      await createTeamSkillTools(EDITOR_USER, TEAM_ID, 'user'),
    )

    const failed = await execTool(skill_create, {
      label: 'Partial write guard',
      name: 'partial-guard-skill',
      description: 'Should not land',
      body: '# Partial',
      files: [
        { path: 'notes.md', content: 'clean' },
        { path: 'SKILL.md', content: 'must use body, not files[]' },
      ],
    })

    expect(failed.ok).toBe(false)
    expect(failed.error).toContain('invalid_input')

    const manifest = await getSkillManifest(`teams/${TEAM_ID}`)

    expect(manifest.skills.some((skill) => skill.name === 'partial-guard-skill')).toBe(false)

    const retry = await execTool(skill_create, {
      label: 'Retry after failed create',
      name: 'partial-guard-skill',
      description: 'Now it works',
      body: '# OK',
    })

    expect(retry.ok).toBe(true)
  })

  test('tools are omitted without a team id', async () => {
    expect(await createTeamSkillTools(EDITOR_USER, null, 'user')).toEqual({})
    expect(await createTeamSkillTools(EDITOR_USER, undefined, 'user')).toEqual({})
  })
})

describe('deleteSkillByName', () => {
  test('removes every object under skills/<name>/ and refreshes manifest', async () => {
    const scope = `teams/${TEAM_ID}`
    const actor = { actor: { userId: EDITOR_USER, source: 'import' as const } }

    await putSkillObject(
      scope,
      'skills/batch-delete/SKILL.md',
      Buffer.from('# Batch'),
      'text/plain',
      actor,
    )
    await putSkillObject(
      scope,
      'skills/batch-delete/scripts/run.sh',
      Buffer.from('#!/bin/sh\necho ok'),
      'text/plain',
      actor,
    )

    const manifestBefore = await getSkillManifest(scope)

    expect(manifestBefore.skills.some((skill) => skill.name === 'batch-delete')).toBe(true)

    const result = await deleteSkillByName(scope, 'batch-delete', actor)

    expect(result.name).toBe('batch-delete')
    expect(result.deletedCount).toBe(2)
    expect(result.keys.toSorted(byCodeUnit)).toEqual([
      'skills/batch-delete/SKILL.md',
      'skills/batch-delete/scripts/run.sh',
    ])

    const manifestAfter = await getSkillManifest(scope)

    expect(manifestAfter.skills.some((skill) => skill.name === 'batch-delete')).toBe(false)
  })

  test('returns 404 when the skill has no objects', async () => {
    await expect(
      deleteSkillByName(`teams/${TEAM_ID}`, 'missing-skill', {
        actor: { userId: EDITOR_USER, source: 'import' },
      }),
    ).rejects.toThrow('Skill not found: missing-skill')
  })
})
