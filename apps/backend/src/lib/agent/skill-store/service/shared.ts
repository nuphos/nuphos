import { promises as fs } from 'node:fs'

import yaml from 'yaml'

import { config } from '@/config'
import { byCodeUnit } from '@/lib/agent/sort-order'
import { AppError } from '@/lib/errors'

import { getBuiltinSkillsDirectory } from '../inject'
import { invalidateMergedSkillsForScope } from '../merge'
import { normalizeSkillScope } from '../scope'
import { getSkillsStore } from '../skills-s3'
import { syncScope } from '../sync'

import { SKILL_OBJECT_KEY_PREFIX } from './types'

import type { SkillsS3Client, SkillS3Object } from '../skills-s3'
import type { SkillObject } from './types'

export function requireSkillsStore(scope?: string): SkillsS3Client {
  return getSkillsStore({ scope })
}

export function isSkillsStoreConfigured(): boolean {
  const { bucket, accessKeyId, secretAccessKey } = config.skillsStore.s3

  return Boolean(bucket && accessKeyId && secretAccessKey)
}

const SKILL_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

export function validateSkillName(name: string): string {
  const trimmed = name.trim()

  if (!trimmed) {
    throw new AppError(400, 'invalid_input', 'skill name is required')
  }
  if (!SKILL_NAME_PATTERN.test(trimmed)) {
    throw new AppError(400, 'invalid_input', `Invalid skill name: ${name}`)
  }

  return trimmed
}

let cachedBuiltinSkillNames: string[] | null = null

export async function listBuiltinSkillNames(): Promise<string[]> {
  if (cachedBuiltinSkillNames) return cachedBuiltinSkillNames
  const root = getBuiltinSkillsDirectory()
  const entries = await fs.readdir(root, { withFileTypes: true })

  cachedBuiltinSkillNames = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort(byCodeUnit)

  return cachedBuiltinSkillNames
}

export function skillNameFromObjectKey(key: string): string | null {
  const parts = key.split('/')

  if (parts.length < 3 || parts[0] !== 'skills' || !parts[1]) return null

  return parts[1]
}

export async function assertSkillNameNotBuiltinOverlay(name: string): Promise<void> {
  const skillName = validateSkillName(name)
  const builtinNames = await listBuiltinSkillNames()

  if (builtinNames.includes(skillName)) {
    throw new AppError(
      403,
      'reserved_skill_name',
      `Cannot create or overwrite builtin skill: ${skillName}`,
    )
  }
}

export function validateSkillRelativePath(relativePath: string): string {
  const trimmed = relativePath.trim().replace(/^\/+/, '')

  if (!trimmed) {
    throw new AppError(400, 'invalid_input', 'path is required')
  }
  if (trimmed.includes('\0') || trimmed.includes('..')) {
    throw new AppError(400, 'invalid_input', `Invalid skill path: ${relativePath}`)
  }

  return trimmed.split('/').join('/')
}

export function buildSkillMdContent(name: string, description: string, body: string): string {
  const frontmatter = yaml
    .stringify({
      name: validateSkillName(name),
      description: description.trim(),
    })
    .trimEnd()
  const trimmedBody = body.trim()

  return trimmedBody ? `---\n${frontmatter}\n---\n\n${trimmedBody}\n` : `---\n${frontmatter}\n---\n`
}

export function skillObjectKeyForName(name: string, relativePath: string): string {
  const skillName = validateSkillName(name)
  const rel = validateSkillRelativePath(relativePath)

  return validateSkillObjectKey(`${SKILL_OBJECT_KEY_PREFIX}${skillName}/${rel}`)
}

export function teamSkillsScope(teamId: string): string {
  return `teams/${teamId}`
}

export async function listSkillScopes(): Promise<string[]> {
  const s3 = requireSkillsStore()
  const scopes = new Set<string>(['global'])

  for (const prefix of await s3.listCommonPrefixes('')) {
    if (prefix === 'global/') {
      scopes.add('global')
      continue
    }
    if (prefix !== 'teams/') continue
    for (const teamPrefix of await s3.listCommonPrefixes('teams/')) {
      scopes.add(teamPrefix.replace(/\/$/, ''))
    }
  }

  return [...scopes].sort((a, b) => a.localeCompare(b))
}

export function validateSkillObjectKey(key: string): string {
  const trimmed = key.trim()

  if (!trimmed) {
    throw new AppError(400, 'invalid_input', 'key is required')
  }
  if (!trimmed.startsWith(SKILL_OBJECT_KEY_PREFIX)) {
    throw new AppError(400, 'invalid_input', `key must start with ${SKILL_OBJECT_KEY_PREFIX}`)
  }
  if (trimmed.includes('\0') || trimmed.includes('..') || trimmed.startsWith('/')) {
    throw new AppError(400, 'invalid_input', `Invalid skill object key: ${key}`)
  }

  return trimmed.split('/').join('/')
}

export function scopeRelativeKey(scope: string, s3Key: string): string {
  const normalized = normalizeSkillScope(scope)
  const prefix = `${normalized}/`

  if (!s3Key.startsWith(prefix)) {
    throw new AppError(500, 'skill_key_scope_mismatch', `Object key outside scope: ${s3Key}`)
  }

  return s3Key.slice(prefix.length)
}

export function toApiObject(scope: string, obj: SkillS3Object): SkillObject {
  return {
    key: scopeRelativeKey(scope, obj.key),
    size: obj.size,
    etag: obj.etag,
    lastModified: obj.lastModified?.toISOString(),
  }
}

export function parseSkillDescription(markdown: string): string | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)
  const rawFrontmatter = match?.[1]

  if (!rawFrontmatter) return null
  try {
    const frontmatter = yaml.parse(rawFrontmatter) as { description?: unknown }

    return typeof frontmatter.description === 'string' ? frontmatter.description : null
  } catch {
    return null
  }
}

export function etagsByRelativeKey(
  scope: string,
  objects: SkillS3Object[],
): Record<string, string> {
  return Object.fromEntries(
    objects.map((object) => [scopeRelativeKey(scope, object.key), object.etag]),
  )
}

export async function listSkillPackageObjects(
  s3: SkillsS3Client,
  scope: string,
  skillName: string,
): Promise<SkillS3Object[]> {
  return s3.listUnderPrefix(`${scope}/${SKILL_OBJECT_KEY_PREFIX}${skillName}/`)
}

export function mutationError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function refreshScopeAfterMutation(scope: string): Promise<void> {
  try {
    await syncScope(scope)
    await invalidateMergedSkillsForScope(scope)
  } catch {
    // S3 mutation succeeded; cache refresh is best-effort and retried on the next resolve.
  }
}
