#!/usr/bin/env bun
// One-off migration for #1930: every Trigger must deliver into one existing
// conversation. Each enabled Trigger without `targetSessionId` is bound to the
// last conversation it created, when that conversation still exists and
// belongs to the Trigger's execution principal in the same team. Otherwise
// the Trigger is disabled. Disabled Triggers are left alone, nothing is
// deleted, and the owner never changes.
//
//   bun scripts/migrate-unbound-triggers.ts --log /tmp/triggers.jsonl            # dry run
//   bun scripts/migrate-unbound-triggers.ts --log /tmp/triggers.jsonl --apply    # write
//
// Every planned or applied change is one JSON line with the Trigger's
// previous fields, so it can be reverted by hand.

import { appendFileSync } from 'node:fs'

import { agentConversations } from '../src/lib/agent/db'
import { triggerExecutionPrincipalId } from '../src/lib/agent/trigger-access'
import { agentTriggers } from '../src/lib/agent/trigger-db'
import { closeDb, connectDb } from '../src/lib/db'
import { clearSlackNotificationIncidentsForTrigger } from '../src/lib/slack/incident-notifications'

import type { AgentTrigger } from '../src/lib/agent/trigger-db'

type Args = { apply: boolean; log: string; teamId?: string }

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  let apply = false
  let log: string | undefined
  let teamId: string | undefined

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]

    if (arg === '--apply') apply = true
    else if (arg === '--log') log = argv[++i]
    else if (arg === '--team') teamId = argv[++i]
    else throw new Error(`Unknown argument: ${String(arg)}`)
  }
  if (!log) {
    throw new Error(
      'usage: bun scripts/migrate-unbound-triggers.ts --log <file.jsonl> [--team <teamId>] [--apply]',
    )
  }

  return { apply, log, ...(teamId ? { teamId } : {}) }
}

/** The fields this migration may change, as they were before. */
function previous(trigger: AgentTrigger) {
  return {
    enabled: trigger.enabled,
    configRevision: trigger.configRevision ?? 0,
    ...(trigger.incidentMode !== undefined ? { incidentMode: trigger.incidentMode } : {}),
    ...(trigger.slackDestination ? { slackDestination: trigger.slackDestination } : {}),
    ...(trigger.sessionRouting ? { sessionRouting: trigger.sessionRouting } : {}),
  }
}

/**
 * Where a Trigger can deliver: its newest run that is not archived, then the
 * conversation that created it. Archived conversations are skipped because a
 * delivery does not restore them. The first candidate the principal owns in
 * the same team wins; every rejected candidate is recorded as the reason.
 */
async function plan(trigger: AgentTrigger) {
  const triggerId = trigger._id!.toHexString()
  const principalUserId = triggerExecutionPrincipalId(trigger)
  const projection = { sessionId: 1, userId: 1, teamId: 1 }
  const lastRun = await agentConversations().findOne(
    { teamId: trigger.teamId, 'metadata.trigger.id': triggerId, archivedAt: { $exists: false } },
    { sort: { createdAt: -1 }, projection },
  )
  const creator = trigger.sourceContext?.sessionId
    ? await agentConversations().findOne(
        { sessionId: trigger.sourceContext.sessionId, archivedAt: { $exists: false } },
        { projection },
      )
    : null
  const rejected: string[] = []
  let target: string | undefined

  for (const [label, candidate] of [
    ['last run', lastRun],
    ['creating conversation', creator],
  ] as const) {
    if (!candidate) rejected.push(`no unarchived ${label}`)
    else if (candidate.teamId !== trigger.teamId || candidate.userId !== principalUserId)
      rejected.push(`${label} belongs to someone else`)
    else {
      target = candidate.sessionId
      break
    }
  }

  return {
    triggerId,
    teamId: trigger.teamId,
    name: trigger.name,
    triggerType: trigger.triggerType,
    principalUserId,
    action: target ? ('bind' as const) : ('disable' as const),
    targetSessionId: target,
    reason: target ? undefined : rejected.join('; '),
    before: previous(trigger),
  }
}

async function main(): Promise<void> {
  const args = parseArgs()

  await connectDb()
  try {
    const triggers = await agentTriggers()
      .find({
        targetSessionId: { $exists: false },
        enabled: true,
        cleanupStatus: { $exists: false },
        // A Watch Group ingress moves with its Group; those are reported, not changed.
        watchGroupId: { $exists: false },
        ...(args.teamId ? { teamId: args.teamId } : {}),
      })
      .sort({ teamId: 1, _id: 1 })
      .toArray()
    const groupIngresses = await agentTriggers().countDocuments({
      targetSessionId: { $exists: false },
      enabled: true,
      watchGroupId: { $exists: true },
      ...(args.teamId ? { teamId: args.teamId } : {}),
    })
    const summary = new Map<string, number>()

    console.log(`${args.apply ? 'APPLY' : 'DRY RUN'}: ${String(triggers.length)} enabled unbound`)
    console.log(`skipped Watch Group ingresses: ${String(groupIngresses)}`)

    for (const trigger of triggers) {
      const change = await plan(trigger)
      // Fence on the exact state we planned against, so a concurrent edit wins.
      const filter = {
        _id: trigger._id,
        targetSessionId: { $exists: false },
        enabled: true,
        configRevision: trigger.configRevision ?? { $exists: false },
      }
      let applied = false

      if (args.apply) {
        const result =
          change.action === 'bind'
            ? await agentTriggers().updateOne(filter, {
                $set: { targetSessionId: change.targetSessionId, updatedAt: new Date() },
                $unset: { incidentMode: true, slackDestination: true, sessionRouting: true },
                $inc: { configRevision: 1 },
              })
            : await agentTriggers().updateOne(filter, {
                $set: { enabled: false, updatedAt: new Date() },
                $inc: { configRevision: 1 },
              })

        applied = result.modifiedCount === 1
        if (applied && trigger.incidentMode) {
          await clearSlackNotificationIncidentsForTrigger(change.triggerId, trigger.teamId)
        }
      }
      const line = { ...change, applied, at: new Date().toISOString() }

      appendFileSync(args.log, `${JSON.stringify(line)}\n`)
      const key = change.action === 'bind' ? 'bind' : `disable: ${String(change.reason)}`

      summary.set(key, (summary.get(key) ?? 0) + 1)
      const detail = change.targetSessionId
        ? '-> ' + change.targetSessionId
        : '(' + String(change.reason) + ')'
      const outcome = applied ? ' applied' : ' SKIPPED (changed concurrently)'

      console.log(
        [change.action.padEnd(7), change.triggerId, 'team=' + String(change.teamId), detail].join(
          ' ',
        ) + (args.apply ? outcome : ''),
      )
    }
    console.log('summary:')
    for (const [key, count] of summary) console.log(`  ${String(count).padStart(4)}  ${key}`)
  } finally {
    await closeDb()
  }
}

await main()
