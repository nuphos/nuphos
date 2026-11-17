import { skillRecords, serializeSkillMetadata } from '@/lib/agent/skill-store/metadata'
import { skillObjectKey } from '@/lib/agent/skill-store/scope'
import {
  isSkillsStoreConfigured,
  listSkillObjects,
  teamSkillsScope,
  validateSkillObjectKey,
} from '@/lib/agent/skill-store/service'
import { requireSkillsStore } from '@/lib/agent/skill-store/service/shared'
import { mongo } from '@/lib/db'
import { AppError } from '@/lib/errors'

import packageJson from '../../../package.json'

import { createMigrationArchive } from './archive'
import { writeDatabase } from './database'
import { MIGRATION_LIMITS, sha256 } from './format'
import { baseExclusions } from './report'

import type { Exclusion } from './report'
import type { ClientSession } from 'mongodb'

async function writeSkills(
  archive: ReturnType<typeof createMigrationArchive>,
  teamId: string,
  exclusions: Exclusion[],
  initialListing: Awaited<ReturnType<typeof listSkillObjects>> | null,
  session: ClientSession,
) {
  const scope = teamSkillsScope(teamId)
  const files = archive.part('knowledge/skill-files.ndjson')

  if (!isSkillsStoreConfigured()) {
    if (await skillRecords().findOne({ scope, status: 'active' }, { session }))
      throw new AppError(
        503,
        'skills_store_unconfigured',
        'Configure the source skill store before exporting its skills',
      )
    files.end()
    archive.part('knowledge/skills.ndjson').end()

    return
  }
  const listing = initialListing ?? (await listSkillObjects(scope))

  if (listing.truncated)
    throw new AppError(413, 'migration_limit', 'Skill listing exceeds migration limits')
  const names = new Set<string>()
  const store = requireSkillsStore(scope)

  for (const object of listing.objects) {
    validateSkillObjectKey(object.key)
    if (object.size > MIGRATION_LIMITS.skillBytes) {
      exclusions.push({
        category: 'skill-asset',
        sourceId: object.key,
        reason: 'Skill asset exceeds 1 MiB',
        nextAction: 'Copy separately',
      })
      continue
    }
    const bytes = await store.getObjectBody(skillObjectKey(scope, object.key), {
      ifMatch: object.etag,
      maxBytes: MIGRATION_LIMITS.skillBytes,
    })
    let text: string

    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      if (text.includes('\0')) throw new Error('binary')
    } catch {
      exclusions.push({
        category: 'skill-asset',
        sourceId: object.key,
        reason: 'Binary skill asset',
        nextAction: 'Copy separately',
      })
      continue
    }
    names.add(object.key.split('/')[1]!)
    files.write({ key: object.key, text, sha256: sha256(bytes) })
  }
  const after = await listSkillObjects(scope)

  if (JSON.stringify(listing.objects) !== JSON.stringify(after.objects) || after.truncated)
    throw new AppError(
      409,
      'migration_source_changed',
      'Skills changed while exporting; retry the export',
    )
  files.end()
  const skills = archive.part('knowledge/skills.ndjson')

  for (const name of [...names].sort((a, b) => a.localeCompare(b))) {
    const record = await skillRecords().findOne({ scope, name }, { session })

    skills.write({ name, metadata: record ? serializeSkillMetadata(record) : null })
  }
  skills.end()
}

export async function exportTeam(teamId: string) {
  const exportedAt = new Date().toISOString()
  const archive = createMigrationArchive({
    format: 'nuphos-team',
    formatVersion: 1,
    backendVersion: packageJson.version,
    sourceTeamId: teamId,
    exportedAt,
    parts: {},
    totals: { records: 0, bytes: 0 },
  })
  const session = mongo.startSession({ snapshot: true })

  try {
    const exclusions = baseExclusions()

    const initialSkills = isSkillsStoreConfigured()
      ? await listSkillObjects(teamSkillsScope(teamId))
      : null

    await writeDatabase(archive, teamId, session, exclusions)
    await writeSkills(archive, teamId, exclusions, initialSkills, session)
    const report = archive.part('not-migrated.json')

    report.write(exclusions)
    report.end()

    return {
      ...archive.finish(),
      dispose: () => {
        archive.dispose()
      },
    }
  } catch (error) {
    archive.dispose()
    throw error
  } finally {
    await session.endSession()
  }
}
