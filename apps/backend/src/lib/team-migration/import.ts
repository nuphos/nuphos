import { MongoError, ObjectId } from 'mongodb'

import { agentConversations, agentMessages } from '@/lib/agent/db/shared'
import { upsertCachedTeam } from '@/lib/agent/directory'
import { agentMemories, teamMemories } from '@/lib/agent/memory-native/store/shared'
import { plans } from '@/lib/agent/plans/collections'
import { skillRecords } from '@/lib/agent/skill-store/metadata'
import { skillObjectKey } from '@/lib/agent/skill-store/scope'
import { teamSkillsScope } from '@/lib/agent/skill-store/service'
import { requireSkillsStore } from '@/lib/agent/skill-store/service/shared'
import { agentTriggers } from '@/lib/agent/trigger-db'
import { db, mongo } from '@/lib/db'
import { createTeamForUser } from '@/lib/identity'
import { mapTeam, teams } from '@/lib/identity/shared'
import {
  agentInstructions,
  architectureDiagrams,
  dashboardPanels,
  designs,
  nuphosDashboards,
  teamHomeLayouts,
} from '@/models'

import { teamSchema } from './import-schemas'
import { importedRows } from './records'
import { migrationIds, remapRecord } from './remap'

import type { MigrationPart } from './format'
import type { ValidatedArchive } from './remap'
import type { ClientSession, Collection, Document } from 'mongodb'

export async function importTeam(archive: ValidatedArchive, actorId: string, selfId?: string) {
  const ids = await migrationIds(archive, actorId, selfId)
  const teamId = new ObjectId()
  const targetId = teamId.toHexString()
  const scope = teamSkillsScope(targetId)
  const uploaded: string[] = []
  const session = mongo.startSession()
  let committed = false
  let uncertainCommit = false
  let store: ReturnType<typeof requireSkillsStore> | undefined

  try {
    // No team exists yet. Conditional writes cannot overwrite another team's
    // objects. Publish the team only after every external write has succeeded.
    for await (const file of importedRows(archive.paths.get('knowledge/skill-files.ndjson')!)) {
      store ??= requireSkillsStore(scope)
      const key = skillObjectKey(scope, String(file.key))

      await store.putObject(key, Buffer.from(String(file.text)), 'text/plain; charset=utf-8', {
        ifNoneMatch: '*',
      })
      uploaded.push(key)
    }
    const settingsRows = []

    for await (const row of importedRows(archive.paths.get('team.json')!)) settingsRows.push(row)
    const settings = teamSchema.parse(settingsRows[0])
    let team: Awaited<ReturnType<typeof createTeamForUser>> | undefined

    await session.withTransaction(
      async () => {
        team = await createTeamForUser(actorId, settings.name, { session, id: teamId })
        // Email-domain auto-join and local computer sharing are permissions, not
        // portable grants. The importer reconnects/invites only after commit.
        await teams().updateOne(
          { _id: teamId },
          {
            $set: {
              agentRuntime: settings.agentRuntime,
              localAgentSharing: 'off',
              allowedEmailDomains: [],
            },
          },
          { session },
        )
        await insertContents(archive, ids, targetId, actorId, session)
        const home = settings.homeLayout

        if (home)
          await teamHomeLayouts().insertOne(
            {
              _id: new ObjectId(),
              teamId,
              userId: null,
              layout: {
                ...home,
                github: [],
                grid: home.grid
                  ?.filter((cell) => !cell.i.startsWith('gh:'))
                  .map((cell) => {
                    const pin = home.panels.find(
                      (panel) => cell.i === `panel:${panel.dashboardId}/${panel.panelId}`,
                    )

                    return pin
                      ? {
                          ...cell,
                          i: `panel:${ids.object('work/dashboards.ndjson', pin.dashboardId).toHexString()}/${ids.object('work/panels.ndjson', pin.panelId).toHexString()}`,
                        }
                      : cell
                  }),
                panels: home.panels.map((panel) => ({
                  dashboardId: ids
                    .object('work/dashboards.ndjson', panel.dashboardId)
                    .toHexString(),
                  panelId: ids.object('work/panels.ndjson', panel.panelId).toHexString(),
                })),
              },
              updatedAt: new Date(),
            },
            { session },
          )
        const reconnect = []

        for await (const row of importedRows(archive.paths.get('not-migrated.json')!))
          reconnect.push(row)
        await db()
          .collection('team_migration_receipts')
          .insertOne(
            {
              _id: new ObjectId(),
              teamId,
              importedBy: actorId,
              importedAt: new Date(),
              archiveSha256: archive.digest,
              sourceTeamId: archive.manifest.sourceTeamId,
              sourceMembers: ids.members,
              historicalUserIds: Object.fromEntries(ids.users),
              reconnect,
              reset: [
                'membership and invitations',
                'email-domain auto-join',
                'local computer sharing',
                'trigger enablement',
                'dashboard refresh schedules',
                'runtime sessions and credentials',
              ],
            },
            { session },
          )
      },
      { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
    )
    committed = true
    if (!team) throw new Error('Import transaction did not create a team')
    const committedTeam = await teams().findOne({ _id: teamId })

    if (!committedTeam) throw new Error('Committed import team is unavailable')
    const mapped = mapTeam(committedTeam)

    upsertCachedTeam(mapped)

    return {
      team: { ...mapped, role: 'ADMINISTRATOR' as const, isOwner: true },
      sha256: archive.digest,
    }
  } catch (error) {
    uncertainCommit =
      error instanceof MongoError && error.hasErrorLabel('UnknownTransactionCommitResult')
    throw error
  } finally {
    await session.endSession()
    // An unknown commit outcome must never delete objects of a visible team.
    if (!committed && !uncertainCommit && store && !(await teams().findOne({ _id: teamId }))) {
      for (const key of uploaded) await store.deleteObject(key)
    }
  }
}

async function insertContents(
  archive: ValidatedArchive,
  ids: Awaited<ReturnType<typeof migrationIds>>,
  teamId: string,
  actorId: string,
  session: ClientSession,
) {
  const destinations: Partial<Record<MigrationPart, Collection>> = {
    'knowledge/instructions.ndjson': db().collection(agentInstructions().collectionName),
    'conversations/sessions.ndjson': db().collection(agentConversations().collectionName),
    'conversations/messages.ndjson': db().collection(agentMessages().collectionName),
    'work/plans.ndjson': db().collection(plans().collectionName),
    'work/dashboards.ndjson': db().collection(nuphosDashboards().collectionName),
    'work/panels.ndjson': db().collection(dashboardPanels().collectionName),
    'work/diagrams.ndjson': db().collection(architectureDiagrams().collectionName),
    'work/designs.ndjson': db().collection(designs().collectionName),
    'work/triggers.ndjson': db().collection(agentTriggers().collectionName),
  }
  let highestPlanNumber = 0
  const messageCounts = new Map<string, number>()

  for (const [part, path] of archive.paths) {
    if (!destinations[part] && part !== 'knowledge/memories.ndjson') continue
    let batch: Document[] = []
    let batchBytes = 0
    let batchDestination: Collection | undefined
    const flush = async () => {
      if (batch.length && batchDestination)
        await batchDestination.insertMany(batch, { session, ordered: true })
      batch = []
      batchBytes = 0
    }

    for await (const row of importedRows(path)) {
      const destination =
        part === 'knowledge/memories.ndjson'
          ? db().collection(
              row.kind === 'record'
                ? agentMemories().collectionName
                : teamMemories().collectionName,
            )
          : destinations[part]!
      const mapped = remapRecord(part, row, ids, teamId, actorId)

      mapped.migrationSource = {
        teamId: archive.manifest.sourceTeamId,
        id: String(row._id ?? row.id ?? row.messageId ?? row.sessionId),
        importedAt: new Date(),
        createdBy: row.createdBy,
        updatedBy: row.updatedBy,
      }

      const size = Buffer.byteLength(JSON.stringify(mapped))

      if (
        batchDestination?.collectionName !== destination.collectionName ||
        batch.length >= 100 ||
        batchBytes + size > 1024 * 1024
      )
        await flush()
      batchDestination = destination
      batch.push(mapped)
      batchBytes += size
      if (part === 'work/plans.ndjson')
        highestPlanNumber = Math.max(highestPlanNumber, Number(row.number))
      if (part === 'conversations/messages.ndjson') {
        const id = String(mapped.sessionId)

        messageCounts.set(id, (messageCounts.get(id) ?? 0) + 1)
      }
    }
    await flush()
  }
  for (const [sessionId, messageCount] of messageCounts)
    await agentConversations().updateOne(
      { teamId, sessionId },
      { $set: { messageCount } },
      { session },
    )
  if (highestPlanNumber)
    await db()
      .collection<{ _id: string; seq: number }>('plan_counters')
      .insertOne({ _id: `team:${teamId}`, seq: highestPlanNumber }, { session })
  for await (const skill of importedRows(archive.paths.get('knowledge/skills.ndjson')!)) {
    const now = new Date()

    await skillRecords().insertOne(
      {
        scope: teamSkillsScope(teamId),
        teamId,
        name: String(skill.name),
        status: 'active',
        createdAt: now,
        updatedAt: now,
        createdByUserId: actorId,
        updatedByUserId: actorId,
        createdSource: 'import',
        updatedSource: 'import',
        revision: 1,
        lastMutationId: `import:${archive.digest}`,
        appliedMutations: [],
        deletedAt: null,
        deletedByUserId: null,
      },
      { session },
    )
  }
}
