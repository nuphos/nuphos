import { byCodeUnit } from '@/lib/agent/sort-order'
import { AppError } from '@/lib/errors'

import {
  getSkillRecord,
  listSkillMutationEvents,
  listSkillRecords,
  serializeSkillMetadata,
} from '../metadata'
import { normalizeSkillScope, skillObjectKey, skillScopeS3Prefix } from '../scope'

import {
  listSkillPackageObjects,
  parseSkillDescription,
  requireSkillsStore,
  toApiObject,
  validateSkillName,
  validateSkillObjectKey,
} from './shared'
import {
  MAX_SKILL_LIST_OBJECTS,
  MAX_SKILL_TEXT_BYTES,
  SKILL_OBJECT_KEY_PREFIX,
  SKILL_PRESIGN_EXPIRY_SECONDS,
} from './types'

import type { SkillMetadataDTO, SkillMutationEventDTO } from '../metadata'
import type {
  SkillManifestResponse,
  SkillObject,
  SkillObjectDetailResponse,
  SkillObjectsResponse,
  SkillSummary,
} from './types'

type SkillAggregate = {
  name: string
  files: SkillObject[]
}

export function groupSkillObjects(objects: SkillObject[]): {
  skills: SkillAggregate[]
  orphans: SkillObject[]
} {
  const bySkill = new Map<string, SkillObject[]>()
  const orphans: SkillObject[] = []

  for (const obj of objects) {
    const parts = obj.key.split('/')

    if (parts.length < 3 || parts[0] !== 'skills') {
      orphans.push(obj)
      continue
    }
    const name = parts[1]

    if (!name) {
      orphans.push(obj)
      continue
    }
    const bucket = bySkill.get(name) ?? []

    bucket.push(obj)
    bySkill.set(name, bucket)
  }

  const skills = [...bySkill.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, files]) => ({ name, files }))

  return { skills, orphans }
}

function summarizeSkill(
  skill: SkillAggregate,
  description: string | null,
): Omit<SkillSummary, 'metadata'> {
  const totalBytes = skill.files.reduce((sum, f) => sum + f.size, 0)
  const lastModified =
    skill.files
      .map((f) => f.lastModified)
      .filter((v): v is string => Boolean(v))
      .sort(byCodeUnit)
      .pop() ?? null
  const skillMdKey = `${SKILL_OBJECT_KEY_PREFIX}${skill.name}/SKILL.md`
  const hasSkillMd = skill.files.some((f) => f.key === skillMdKey)

  return {
    name: skill.name,
    displayName: skill.name,
    description,
    fileCount: skill.files.length,
    hasSkillMd,
    totalBytes,
    lastModified,
  }
}

function legacySkillMetadata(lastModified: string | null): SkillMetadataDTO {
  return {
    createdAt: null,
    createdByUserId: null,
    createdSource: 'legacy',
    updatedAt: lastModified,
    updatedByUserId: null,
    updatedSource: 'legacy',
    revision: 0,
    status: 'active',
    deletedAt: null,
    deletedByUserId: null,
    legacy: true,
  }
}

export async function getSkillManifest(scope: string): Promise<SkillManifestResponse> {
  const normalized = normalizeSkillScope(scope)
  const listing = await listSkillObjects(normalized)
  const { skills, orphans } = groupSkillObjects(listing.objects)
  const s3 = requireSkillsStore(normalized)

  const summaries: Omit<SkillSummary, 'metadata'>[] = []

  for (const skill of skills) {
    let description: string | null = null
    const skillMdKey = `${SKILL_OBJECT_KEY_PREFIX}${skill.name}/SKILL.md`
    const skillMd = skill.files.find((f) => f.key === skillMdKey)

    if (skillMd) {
      try {
        const body = await s3.getObjectBody(skillObjectKey(normalized, skillMdKey))

        description = parseSkillDescription(body.toString('utf8'))
      } catch {
        description = null
      }
    }
    summaries.push(summarizeSkill(skill, description))
  }

  const records = await listSkillRecords(
    normalized,
    summaries.map((summary) => summary.name),
  )
  const recordsByName = new Map(records.map((record) => [record.name, record]))

  return {
    scope: normalized,
    skills: summaries.map((summary) => {
      const record = recordsByName.get(summary.name)

      return {
        ...summary,
        metadata: record
          ? serializeSkillMetadata(record)
          : legacySkillMetadata(summary.lastModified),
      }
    }),
    orphans,
    truncated: listing.truncated,
    limit: listing.limit,
  }
}

export async function getSkillMetadata(scope: string, name: string): Promise<SkillMetadataDTO> {
  const normalized = normalizeSkillScope(scope)
  const skillName = validateSkillName(name)
  const record = await getSkillRecord(normalized, skillName)

  if (record) return serializeSkillMetadata(record)

  const s3 = requireSkillsStore(normalized)
  const objects = await listSkillPackageObjects(s3, normalized, skillName)

  if (objects.length === 0) {
    throw new AppError(404, 'skill_not_found', `Skill not found: ${skillName}`)
  }
  const lastModified =
    objects
      .map((object) => object.lastModified?.toISOString())
      .filter((value): value is string => Boolean(value))
      .sort(byCodeUnit)
      .pop() ?? null

  return legacySkillMetadata(lastModified)
}

export async function getSkillMutationHistory(
  scope: string,
  name: string,
  limit = 100,
): Promise<SkillMutationEventDTO[]> {
  return listSkillMutationEvents(normalizeSkillScope(scope), validateSkillName(name), limit)
}

export async function listSkillObjects(
  scope: string,
  limit = MAX_SKILL_LIST_OBJECTS,
): Promise<SkillObjectsResponse> {
  const normalized = normalizeSkillScope(scope)
  const s3 = requireSkillsStore(normalized)
  const prefix = skillScopeS3Prefix(normalized)
  const remote = await s3.listUnderPrefix(prefix)
  const objects = remote.map((obj) => toApiObject(normalized, obj))
  const truncated = objects.length > limit

  return {
    scope: normalized,
    objects: truncated ? objects.slice(0, limit) : objects,
    truncated,
    limit,
  }
}

export async function getSkillObject(
  scope: string,
  key: string,
): Promise<SkillObjectDetailResponse> {
  const normalized = normalizeSkillScope(scope)
  const relKey = validateSkillObjectKey(key)
  const s3Key = skillObjectKey(normalized, relKey)
  const s3 = requireSkillsStore(normalized)
  const head = await s3.headObject(s3Key)

  if (!head) {
    throw new AppError(404, 'skill_object_not_found', `Skill object not found: ${relKey}`)
  }

  let text: string | null = null
  let textTruncated = false

  if (head.size <= MAX_SKILL_TEXT_BYTES) {
    const body = await s3.getObjectBody(s3Key)

    text = body.toString('utf8')
  } else {
    textTruncated = true
  }

  const presignedUrl = await s3.presignDownload(s3Key, SKILL_PRESIGN_EXPIRY_SECONDS)

  return {
    scope: normalized,
    key: relKey,
    size: head.size,
    etag: head.etag,
    contentType: head.contentType,
    lastModified: head.lastModified?.toISOString() ?? null,
    presignedUrl,
    text,
    textTruncated,
  }
}
