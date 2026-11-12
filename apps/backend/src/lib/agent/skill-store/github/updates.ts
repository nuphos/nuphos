import {
  deleteSkillObject,
  putSkillObjects,
  skillObjectKeyForName,
  skillPackageEtags,
} from '@/lib/agent/skill-store/service'
import { AppError } from '@/lib/errors'

import { discoverSkills } from './discover'
import { assess, fetchRepoArchive } from './install'
import { listSkillOrigins, recordSkillOrigin, skillContentHash, skillFileHashes } from './origin'
import { parseGithubSource } from './source'

import type { DiscoveredSkill } from './discover'
import type { GithubSkillCandidate } from './install'
import type { SkillOrigin } from './origin'
import type { SkillMutationContext } from '@/lib/agent/skill-store/service'

export type GithubSkillUpdate = {
  name: string
  repo: string
  ref: string | null
  path: string
  installedCommit: string
  latestCommit: string | null
  status: 'up_to_date' | 'update_available' | 'source_missing'
  /** Changed in Nuphos since install; updating replaces those edits. */
  edited: boolean
  /** Upstream changes since install, by path inside the skill folder. */
  changes: { added: string[]; changed: string[]; removed: string[] }
  /** Why the upstream version cannot be installed, if it cannot. */
  problem: GithubSkillCandidate['problem']
}

type Inspected = {
  report: GithubSkillUpdate
  origin: SkillOrigin
  upstream: DiscoveredSkill | null
  /** Package ETags when inspected, to catch edits made while the update runs. */
  current: Record<string, string>
}

type Tracked = { origin: SkillOrigin; current: Record<string, string> }

const NO_CHANGES = { added: [], changed: [], removed: [] }

function sameEtags(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a)

  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key])
}

function changesSince(origin: SkillOrigin, hashes: Record<string, string>) {
  const before = origin.fileHashes

  // Without a per-file baseline, every upstream file may have changed.
  if (!before) return { added: [], changed: Object.keys(hashes), removed: [] }

  return {
    added: Object.keys(hashes).filter((path) => !(path in before)),
    changed: Object.keys(hashes).filter((path) => path in before && before[path] !== hashes[path]),
    removed: Object.keys(before).filter((path) => !(path in hashes)),
  }
}

async function inspect(
  origin: SkillOrigin,
  archive: { commitSha: string; files: Map<string, Uint8Array> },
  current: Record<string, string>,
): Promise<Inspected> {
  const found = discoverSkills(archive.files, origin.path || null).find(
    (skill) => skill.path === origin.path,
  )
  const base = {
    name: origin.name,
    repo: origin.repo,
    ref: origin.ref,
    path: origin.path,
    installedCommit: origin.commitSha,
    latestCommit: archive.commitSha,
    edited: !sameEtags(current, origin.installedEtags),
  }

  if (!found) {
    const report = {
      ...base,
      status: 'source_missing' as const,
      changes: NO_CHANGES,
      problem: null,
    }

    return { report, origin, upstream: null, current }
  }
  const upstream = { ...found, name: origin.name }
  const unchanged = skillContentHash(found.files) === origin.contentHash
  const empty = { builtin: new Set<string>(), existing: new Set<string>() }
  const report: GithubSkillUpdate = {
    ...base,
    status: unchanged ? 'up_to_date' : 'update_available',
    changes: changesSince(origin, skillFileHashes(found.files)),
    problem: unchanged ? null : await assess(upstream, empty),
  }

  return { report, origin, upstream, current }
}

function sourceGone({ origin, current }: Tracked): Inspected {
  const report: GithubSkillUpdate = {
    name: origin.name,
    repo: origin.repo,
    ref: origin.ref,
    path: origin.path,
    installedCommit: origin.commitSha,
    latestCommit: null,
    status: 'source_missing',
    edited: !sameEtags(current, origin.installedEtags),
    changes: NO_CHANGES,
    problem: null,
  }

  return { report, origin, upstream: null, current }
}

/** The commit to download for one source: its ref, or the commit the member reviewed. */
function pinnedRef(tracked: Tracked[], pins: Record<string, string> | null): string | null {
  const first = tracked[0]?.origin

  if (!pins) return first?.ref ?? null
  const shas = new Set(tracked.map(({ origin }) => pins[origin.name]))
  const [sha] = shas

  if (shas.size !== 1 || !sha)
    throw new AppError(
      400,
      'invalid_input',
      'Send the reviewed commit of every skill from a source',
    )

  return sha
}

async function downloadFor(
  tracked: Tracked[],
  pins: Record<string, string> | null,
  download: typeof fetchRepoArchive,
) {
  const [first] = tracked

  if (!first) return null
  const ref = pinnedRef(tracked, pins)

  try {
    const archive = await download(parseGithubSource(first.origin.repo), ref)

    if (pins && archive.commitSha !== ref)
      throw new AppError(
        409,
        'source_changed',
        'Repository archive does not match the reviewed commit',
      )

    return archive
  } catch (err) {
    if (!pins && err instanceof AppError && err.code === 'source_not_found') return null
    throw err
  }
}

/**
 * Downloads each tracked (repo, ref) once, or the commit in `pins` when applying
 * an update the member reviewed, and compares it with what was installed.
 */
async function inspectAll(
  scope: string,
  names: string[] | null,
  download: typeof fetchRepoArchive,
  pins: Record<string, string> | null = null,
) {
  const origins = (await listSkillOrigins(scope)).filter((o) => !names || names.includes(o.name))
  const groups = Map.groupBy(origins, (origin) => `${origin.repo}#${origin.ref ?? ''}`)
  const inspected: Inspected[] = []

  for (const group of groups.values()) {
    const tracked: Tracked[] = []

    for (const origin of group) {
      const current = await skillPackageEtags(scope, origin.name)

      if (Object.keys(current).length > 0) tracked.push({ origin, current })
    }
    if (tracked.length === 0) continue
    const archive = await downloadFor(tracked, pins, download)

    for (const entry of tracked) {
      const result = archive
        ? await inspect(entry.origin, archive, entry.current)
        : sourceGone(entry)

      // A report-only check keeps no file bytes, so each archive is freed before the next download.
      inspected.push(pins ? result : { ...result, upstream: null })
    }
  }

  return inspected.sort((a, b) => a.report.name.localeCompare(b.report.name))
}

export async function checkGithubSkillUpdates(
  scope: string,
  download = fetchRepoArchive,
): Promise<GithubSkillUpdate[]> {
  return (await inspectAll(scope, null, download)).map((entry) => entry.report)
}

function assertUpdatable(entry: Inspected | undefined, name: string, overwrite: string[]) {
  if (!entry) throw new AppError(404, 'skill_not_tracked', `${name} was not installed from GitHub`)
  const { report } = entry

  if (report.status !== 'update_available' || !entry.upstream)
    throw new AppError(409, 'no_update', `${name} has no update to apply`)
  if (report.problem)
    throw new AppError(409, 'skill_not_installable', `${name}: ${report.problem.message}`)
  if (report.edited && !overwrite.includes(name))
    throw new AppError(
      409,
      'skill_edited',
      `${name} was edited in Nuphos; confirm to replace the edits`,
    )

  return { ...entry, upstream: entry.upstream }
}

/**
 * Replaces each named skill with its upstream folder: new and changed files in
 * one mutation, then files no longer upstream are removed. Edited skills need
 * their name in `overwriteEdited`.
 */
export async function updateGithubSkills(
  scope: string,
  input: { names: string[]; overwriteEdited: string[]; commits: Record<string, string> },
  context: SkillMutationContext,
  download = fetchRepoArchive,
): Promise<GithubSkillUpdate[]> {
  const inspected = await inspectAll(scope, input.names, download, input.commits)
  const chosen = input.names.map((name) =>
    assertUpdatable(
      inspected.find((entry) => entry.report.name === name),
      name,
      input.overwriteEdited,
    ),
  )

  for (const { origin, upstream, report, current } of chosen) {
    const now = await skillPackageEtags(scope, origin.name)

    if (!sameEtags(now, current) && !input.overwriteEdited.includes(origin.name))
      throw new AppError(409, 'skill_edited', `${origin.name} changed while updating; check again`)
    const writes = [...upstream.files].map(([path, data]) => ({
      key: skillObjectKeyForName(origin.name, path),
      body: Buffer.from(data),
    }))
    const keys = new Set(writes.map((write) => write.key))
    const step = (suffix: string) => ({
      ...context,
      mutationId: context.mutationId && `${context.mutationId}:${origin.name}:${suffix}`,
    })

    // Conditional writes: a file saved since `now` makes the write fail instead of being replaced.
    const saved = await putSkillObjects(scope, writes, step('put'), { expectedEtags: now })
    const after = await skillPackageEtags(scope, origin.name)

    // A stale file edited since `now` stays, and the next check reports the skill as edited.
    for (const stale of Object.keys(now))
      if (!keys.has(stale) && after[stale] === now[stale])
        await deleteSkillObject(scope, stale, step(`delete:${stale}`))
    await recordSkillOrigin({
      ...origin,
      commitSha: report.latestCommit ?? origin.commitSha,
      contentHash: skillContentHash(upstream.files),
      fileHashes: skillFileHashes(upstream.files),
      // The update's own ETags: an edit saved meanwhile must still read as an edit.
      installedEtags: Object.fromEntries(saved.map((object) => [object.key, object.etag])),
      installedAt: new Date(),
      installedByUserId: context.actor.userId,
    })
  }

  return chosen.map((entry) => entry.report)
}
