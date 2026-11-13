import { ObjectId } from 'mongodb'

import { agentConversations, agentMessages } from '@/lib/agent/db/shared'
import { agentMemories, teamMemories } from '@/lib/agent/memory-native/store/shared'
import { plans } from '@/lib/agent/plans/collections'
import { serializePlan } from '@/lib/agent/plans/serialize'
import { agentTriggers } from '@/lib/agent/trigger-db'
import { AppError } from '@/lib/errors'
import { teams, users } from '@/lib/identity/shared'
import {
  architectureDiagrams,
  dashboardPanels,
  designs,
  nuphosDashboards,
  agentInstructions,
  teamHomeLayouts,
} from '@/models'
import { serializeDashboard } from '@/routes/dashboards/serialize'

import { portableSchemas } from './format'
import { writeReconnectReport } from './report'

import type { createMigrationArchive } from './archive'
import type { MigrationPart } from './format'
import type { Exclusion } from './report'
import type { ClientSession, FindCursor, Document } from 'mongodb'

async function writeRows<T extends Document>(
  archive: ReturnType<typeof createMigrationArchive>,
  name: MigrationPart,
  cursor: FindCursor<T>,
  serialize: (row: T) => unknown,
) {
  const part = archive.part(name)

  try {
    for await (const row of cursor) part.write(serialize(row))
    part.end()
  } finally {
    await cursor.close()
  }
}

async function writeIdentity(
  archive: ReturnType<typeof createMigrationArchive>,
  teamId: string,
  session: ClientSession,
) {
  const team = await teams().findOne({ _id: new ObjectId(teamId) }, { session })

  if (!team) throw new AppError(404, 'team_not_found', 'Team not found')
  const home = await teamHomeLayouts().findOne(
    { teamId: new ObjectId(teamId), userId: null },
    { session },
  )
  const part = archive.part('team.json')

  part.write({
    sourceTeamId: teamId,
    name: team.name,
    allowedEmailDomains: team.allowedEmailDomains ?? [],
    agentRuntime: team.agentRuntime,
    localAgentSharing: team.localAgentSharing,
    homeLayout: home
      ? {
          team: home.layout.team,
          panels: home.layout.panels.map((panel) => ({
            dashboardId: panel.dashboardId,
            panelId: panel.panelId,
          })),
          metrics: home.layout.metrics?.map((metric) => ({
            id: metric.id,
            kind: metric.kind,
            range: metric.range,
            scope: metric.scope,
          })),
          grid: home.layout.grid?.map((cell) => ({
            i: cell.i,
            x: cell.x,
            y: cell.y,
            w: cell.w,
            h: cell.h,
          })),
          gridVersion: home.layout.gridVersion,
        }
      : null,
  })
  part.end()
  const memberRows = []

  for (const member of team.members) {
    const user = await users().findOne(
      { _id: member.userId },
      { session, projection: { email: 1, name: 1 } },
    )

    memberRows.push({
      sourceUserId: member.userId.toHexString(),
      name: user?.name ?? 'Former member',
      email: user?.email ?? null,
      role: member.role,
      joinedAt: member.joinedAt.toISOString(),
      removedAt: member.deletedAt?.toISOString() ?? null,
    })
  }
  const members = archive.part('members.json')

  members.write(memberRows)
  members.end()
}

function portablePlan(row: Parameters<typeof serializePlan>[0]) {
  const plan = serializePlan(row)

  return {
    id: plan.id,
    number: plan.number,
    createdBy: plan.createdBy,
    sourceConversationId: plan.sourceConversationId,
    title: plan.title,
    overview: plan.overview,
    decisions: plan.decisions?.map((value) => ({ label: value.label, value: value.value })),
    steps: plan.steps.map((step) => ({
      title: step.title,
      description: step.description,
      jobs: step.jobs.map((job) => ({
        title: job.title,
        description: job.description,
        commands: job.commands?.map((command) => ({
          command: command.command,
          description: command.description,
          status: 'pending',
        })),
      })),
    })),
    costSummary: plan.costSummary,
    costOneTime: plan.costOneTime,
    costMonthly: plan.costMonthly,
    costSavings: plan.costSavings,
    riskWorstCase: plan.riskWorstCase,
    riskMitigations: plan.riskMitigations,
    status: 'proposed',
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  }
}

export async function writeDatabase(
  archive: ReturnType<typeof createMigrationArchive>,
  teamId: string,
  session: ClientSession,
  exclusions: Exclusion[],
) {
  const teamObjectId = new ObjectId(teamId)

  await writeIdentity(archive, teamId, session)
  await writeRows(
    archive,
    'knowledge/instructions.ndjson',
    agentInstructions().find({ teamId: teamObjectId, scope: 'team' }, { session }),
    (row) => portableSchemas.instruction.parse(row),
  )
  const memories = archive.part('knowledge/memories.ndjson')

  for await (const row of agentMemories().find({ teamId, scope: 'team' }, { session }))
    memories.write({ kind: 'record', ...portableSchemas.memory.parse(row) })
  for await (const row of teamMemories().find({ teamId }, { session }))
    memories.write({ kind: 'playbook', ...portableSchemas.playbook.parse(row) })
  memories.end()

  await writeRows(
    archive,
    'conversations/sessions.ndjson',
    agentConversations().find({ teamId }, { session }).sort({ sessionId: 1 }),
    (row) => portableSchemas.session.parse(row),
  )
  await writeRows(
    archive,
    'work/bots.ndjson',
    agentConversations().find(
      { teamId, avatar: { $exists: true }, kind: { $ne: 'channel' } },
      { session },
    ),
    (row) => ({ sessionId: row.sessionId }),
  )
  const messages = archive.part('conversations/messages.ndjson')

  // Read children through their owning conversation, never by an unscoped user id.
  for await (const row of agentConversations().find(
    { teamId },
    { session, projection: { sessionId: 1 } },
  )) {
    for await (const message of agentMessages()
      .find({ sessionId: row.sessionId }, { session })
      .sort({ index: 1, messageId: 1 })) {
      messages.write(portableSchemas.message.parse(message))
    }
  }
  messages.end()
  const triggers = archive.part('work/triggers.ndjson')

  for await (const row of agentConversations().find(
    { teamId },
    { session, projection: { sessionId: 1 } },
  )) {
    for await (const trigger of agentTriggers().find(
      { targetSessionId: row.sessionId },
      { session },
    )) {
      triggers.write(portableSchemas.trigger.parse(trigger))
    }
  }
  triggers.end()
  for await (const row of agentTriggers().find(
    { teamId },
    { session, projection: { _id: 1, targetSessionId: 1 } },
  )) {
    const owner = row.targetSessionId
      ? await agentConversations().findOne(
          { sessionId: row.targetSessionId, teamId },
          { session, projection: { _id: 1 } },
        )
      : null

    if (!owner)
      exclusions.push({
        category: 'unbound-trigger',
        sourceId: String(row._id),
        reason: 'Trigger has no owning conversation in this team',
        nextAction: 'Recreate against a destination Task or Bot',
      })
  }
  await writeReconnectReport(teamId, session, exclusions)
  await writeRows(archive, 'work/plans.ndjson', plans().find({ teamId }, { session }), (row) => {
    if (row.actions?.length)
      exclusions.push({
        category: 'plan-actions',
        sourceId: String(row.number),
        reason: 'Executable database actions and approvals are not migrated',
        nextAction: 'Review and recreate required actions on the destination',
      })

    return portablePlan(row)
  })
  await writeRows(
    archive,
    'work/dashboards.ndjson',
    nuphosDashboards().find({ teamId: teamObjectId }, { session }),
    (row) => {
      const {
        nextRefreshAt: _next,
        lastScheduledRefreshAt: _last,
        ...portable
      } = serializeDashboard(row)

      return portable
    },
  )
  await writeRows(
    archive,
    'work/panels.ndjson',
    dashboardPanels().find({ teamId: teamObjectId }, { session }),
    (row) => {
      if (row.staticParams)
        exclusions.push({
          category: 'panel-parameters',
          sourceId: String(row._id),
          reason: 'Unrestricted structured parameters are excluded',
          nextAction: 'Reconfigure static parameters and credentials before enabling the panel',
        })

      return portableSchemas.panel.parse(row)
    },
  )
  await writeRows(
    archive,
    'work/diagrams.ndjson',
    architectureDiagrams().find({ teamId: teamObjectId }, { session }),
    (row) => portableSchemas.diagram.parse(row),
  )
  await writeRows(
    archive,
    'work/designs.ndjson',
    designs().find({ teamId: teamObjectId }, { session }),
    (row) => portableSchemas.design.parse(row),
  )
  archive.part('work/schedules.ndjson').end()
}
