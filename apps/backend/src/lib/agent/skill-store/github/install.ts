import { readBoundedBody } from '@/lib/agent/inbound-files'
import {
  getSkillManifest,
  listBuiltinSkillNames,
  MAX_SKILL_UPLOAD_BYTES,
  putSkillObjects,
  skillObjectKeyForName,
  skillPackageExists,
  validateSkillName,
  validateSkillRelativePath,
} from '@/lib/agent/skill-store/service'
import { AppError } from '@/lib/errors'
import { pinnedFetch } from '@/lib/net/safe-outbound'
import { findEmbeddedSecret, findSecrets } from '@/lib/secrets/scan'

import { discoverSkills } from './discover'
import { recordSkillOrigin, skillContentHash } from './origin'
import { githubSourceLabel, parseGithubSource } from './source'
import { readRepoTarball, TARBALL_LIMITS } from './tarball'

import type { DiscoveredSkill } from './discover'
import type { GithubSkillSource } from './source'
import type { RepoArchive } from './tarball'
import type { SkillMutationContext } from '@/lib/agent/skill-store/service'

export const GITHUB_SKILL_LIMITS = { files: 200, bytes: 25_000_000, listed: 100 }

export type GithubSkillCandidate = {
  name: string
  description: string | null
  path: string
  fileCount: number
  totalBytes: number
  /** Links and other entries in the folder that are not installed. */
  skipped: string[]
  problem: { code: string; message: string } | null
}

export type GithubSkillPreview = {
  repo: string
  ref: string | null
  subpath: string | null
  commitSha: string
  skills: GithubSkillCandidate[]
  truncated: boolean
}

export async function fetchRepoArchive(source: GithubSkillSource, ref: string | null) {
  const path = (ref ?? 'HEAD').split('/').map(encodeURIComponent).join('/')
  const url = `https://codeload.github.com/${source.owner}/${source.repo}/tar.gz/${path}`
  const response = await pinnedFetch(url, { signal: AbortSignal.timeout(60_000) })

  if (response.status === 404)
    throw new AppError(
      404,
      'source_not_found',
      'Repository or ref not found, or the repository is not public',
    )
  if (!response.ok)
    throw new AppError(502, 'source_unavailable', `GitHub returned ${String(response.status)}`)
  const body = await readBoundedBody(response, TARBALL_LIMITS.compressedBytes)

  if (!body) throw new AppError(413, 'archive_too_large', 'Repository archive is too large')
  const archive = readRepoTarball(body)

  if (!archive.commitSha || !/^[0-9a-f]{40}$/.test(archive.commitSha))
    throw new AppError(502, 'invalid_archive', 'Repository archive has no commit id')

  return archive as RepoArchive & { commitSha: string }
}

async function secretIn(data: Uint8Array): Promise<string | null> {
  try {
    return await findEmbeddedSecret(new TextDecoder('utf-8', { fatal: true }).decode(data))
  } catch {
    const [hit] = await findSecrets(new TextDecoder().decode(data), 'tokenShapes')

    return hit ? `content appears to contain a secret (${hit.kind})` : null
  }
}

const fail = (code: string, message: string) => ({ code, message })

type Taken = { builtin: Set<string>; existing: Set<string> }

async function assess(
  skill: DiscoveredSkill,
  taken: Taken,
): Promise<GithubSkillCandidate['problem']> {
  const sizes = [...skill.files.values()].map((data) => data.byteLength)

  if (skill.malformed) return fail('malformed', 'SKILL.md needs a name and a description')
  try {
    validateSkillName(skill.name)
  } catch {
    return fail('invalid_name', `"${skill.name}" is not a valid skill name`)
  }
  if (taken.builtin.has(skill.name)) return fail('reserved_name', 'A built-in skill uses this name')
  if (taken.existing.has(skill.name)) return fail('exists', 'A skill with this name already exists')
  if (sizes.length > GITHUB_SKILL_LIMITS.files) return fail('too_many_files', 'Too many files')
  if (
    sizes.some((size) => size > MAX_SKILL_UPLOAD_BYTES) ||
    sizes.reduce((a, b) => a + b, 0) > GITHUB_SKILL_LIMITS.bytes
  )
    return fail('too_large', 'Skill is too large')
  for (const [path, data] of skill.files) {
    try {
      validateSkillRelativePath(path)
    } catch {
      return fail('unsafe_path', `Unsupported file path: ${path}`)
    }
    const secret = await secretIn(data)

    if (secret) return fail('secret', `${path}: ${secret}`)
  }

  return null
}

async function candidates(scope: string, archive: RepoArchive, subpath: string | null) {
  const [builtin, manifest] = await Promise.all([listBuiltinSkillNames(), getSkillManifest(scope)])
  const found = discoverSkills(archive.files, subpath)
  const listed = found.slice(0, GITHUB_SKILL_LIMITS.listed)
  const existing = new Set(manifest.skills.map((s) => s.name))

  // A truncated manifest can miss stored skills, so look each candidate up directly.
  if (manifest.truncated)
    for (const { name } of listed) if (await skillPackageExists(scope, name)) existing.add(name)
  const taken = { builtin: new Set(builtin), existing }
  const assessed = await Promise.all(
    listed.map(async (skill) => {
      const prefix = skill.path ? `${skill.path}/` : ''
      const candidate: GithubSkillCandidate = {
        name: skill.name,
        description: skill.description,
        path: skill.path,
        fileCount: skill.files.size,
        totalBytes: [...skill.files.values()].reduce((sum, data) => sum + data.byteLength, 0),
        skipped: archive.skipped
          .filter((path) => path.startsWith(prefix))
          .map((path) => path.slice(prefix.length)),
        problem: await assess(skill, taken),
      }

      return { skill, candidate }
    }),
  )

  return { assessed, truncated: found.length > listed.length }
}

export async function previewGithubSkills(
  scope: string,
  rawSource: string,
  download = fetchRepoArchive,
): Promise<GithubSkillPreview> {
  const source = parseGithubSource(rawSource)
  const archive = await download(source, source.ref)
  const { assessed, truncated } = await candidates(scope, archive, source.subpath)

  return {
    repo: githubSourceLabel(source),
    ref: source.ref,
    subpath: source.subpath,
    commitSha: archive.commitSha,
    skills: assessed.map((entry) => entry.candidate),
    truncated,
  }
}

/** Installs the named skills from exactly the commit the member previewed. */
export async function installGithubSkills(
  scope: string,
  input: { source: string; commitSha: string; names: string[] },
  context: SkillMutationContext,
  download = fetchRepoArchive,
): Promise<GithubSkillCandidate[]> {
  const source = parseGithubSource(input.source)
  const archive = await download(source, input.commitSha)

  if (archive.commitSha !== input.commitSha)
    throw new AppError(
      409,
      'source_changed',
      'Repository archive does not match the previewed commit',
    )
  const { assessed } = await candidates(scope, archive, source.subpath)
  const chosen = input.names.map((name) => {
    const entry = assessed.find((item) => item.candidate.name === name)

    if (!entry) throw new AppError(404, 'skill_not_found', `No skill named ${name} in this source`)
    if (entry.candidate.problem)
      throw new AppError(
        409,
        'skill_not_installable',
        `${name}: ${entry.candidate.problem.message}`,
      )

    return entry
  })

  for (const { skill } of chosen)
    if (await skillPackageExists(scope, skill.name))
      throw new AppError(
        409,
        'skill_exists',
        `${skill.name}: A skill with this name already exists`,
      )
  for (const { skill } of chosen) {
    const writes = [...skill.files].map(([path, body]) => ({
      key: skillObjectKeyForName(skill.name, path),
      body: Buffer.from(body),
    }))
    const saved = await putSkillObjects(scope, writes, {
      ...context,
      mutationId: context.mutationId && `${context.mutationId}:${skill.name}`,
    })

    await recordSkillOrigin({
      scope,
      name: skill.name,
      repo: githubSourceLabel(source),
      ref: source.ref,
      path: skill.path,
      commitSha: archive.commitSha,
      contentHash: skillContentHash(skill.files),
      installedEtags: Object.fromEntries(saved.map((object) => [object.key, object.etag])),
      installedAt: new Date(),
      installedByUserId: context.actor.userId,
    })
  }

  return chosen.map((entry) => entry.candidate)
}
