import { randomUUID } from 'node:crypto'

import { appendAutonomousConversationTurn, resolvePlanInputRequests } from '@/lib/agent/db'
import { logEvent } from '@/lib/observability'
import { databaseConnections } from '@/models/database'

import { planApprovalPolicies, plans } from './collections'

const RETIRED =
  'Plans were replaced by approval decisions, so this Plan was cancelled before it ran to completion.'

/**
 * Agents now ask for approval with a decision instead of a Plan, so a Plan left
 * open would wait forever. Cancels each one, clears its question from the Inbox
 * and tells its conversation why. Database changes keep their Plans. Idempotent.
 */
export async function cancelOpenAgentPlans(): Promise<number> {
  const open = await plans()
    .find({
      status: { $in: ['proposed', 'approved', 'executing'] },
      'actions.type': { $ne: 'mongodb.change' },
    })
    .toArray()
  let cancelled = 0

  for (const plan of open) {
    const result = await plans().updateOne(
      { _id: plan._id, status: plan.status },
      { $set: { status: 'cancelled', executionError: RETIRED, updatedAt: new Date() } },
    )

    if (result.modifiedCount === 0) continue
    cancelled++
    if (!plan.sourceConversationId) continue
    await resolvePlanInputRequests(plan.sourceConversationId, String(plan.number))
    if (!plan.teamId) continue
    await appendAutonomousConversationTurn({
      sessionId: plan.sourceConversationId,
      userId: plan.createdBy,
      teamId: plan.teamId,
      message: {
        id: randomUUID(),
        parts: [
          {
            type: 'text',
            text: `Plan #${String(plan.number)} "${plan.title}" was cancelled because Plans were replaced by approval decisions. Ask me to continue and I will request approval again before any risky change.`,
          },
        ],
      },
    })
  }

  return cancelled
}

/**
 * Database changes used to follow the team's Plan approval policy. They follow
 * each connection's own policy again, so every connection takes the larger of
 * its own minimum and its team's. Never lowers a minimum, so it is idempotent.
 */
export async function migrateTeamPlanApprovalPolicies(now = new Date()): Promise<number> {
  // Each team policy migrates once, so a connection an admin lowers later stays lowered.
  const unmigrated = { minimumOtherApprovals: { $gt: 0 }, migratedAt: { $exists: false } }
  const teams = new Map(
    (await planApprovalPolicies().find(unmigrated).toArray()).map((policy) => [policy._id, policy]),
  )
  let raised = 0

  if (teams.size === 0) return raised
  for (const connection of await databaseConnections().find({}).toArray()) {
    const team = teams.get(String(connection.teamId))
    // A connection saved without a policy has always needed one approval.
    const current = connection.changeApprovalPolicy ?? { minimumApprovals: 1, version: 1 }

    if (!team || team.minimumOtherApprovals <= current.minimumApprovals) continue
    // Writes only over the policy it read, so a concurrent boot or admin edit wins.
    const result = await databaseConnections().updateOne(
      connection.changeApprovalPolicy
        ? {
            _id: connection._id,
            'changeApprovalPolicy.version': current.version,
            'changeApprovalPolicy.minimumApprovals': current.minimumApprovals,
          }
        : { _id: connection._id, changeApprovalPolicy: { $exists: false } },
      {
        $set: {
          changeApprovalPolicy: {
            minimumApprovals: team.minimumOtherApprovals,
            version: current.version,
            updatedAt: now,
            updatedBy: team.updatedBy,
          },
        },
      },
    )

    raised += result.modifiedCount
  }
  await planApprovalPolicies().updateMany(unmigrated, { $set: { migratedAt: now } })
  if (raised > 0) logEvent('info', 'backend.migration.database_change_policies_raised', { raised })

  return raised
}
