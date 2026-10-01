#!/usr/bin/env bun
// Resolve stale skill mutation intents left behind when S3 changed but the
// process exited before writing the Mongo result event/projection.

import {
  SKILL_EVENTS_COLLECTION,
  skillEvents,
  skillMetadataRepository,
} from '../src/lib/agent/skill-store/metadata'
import { getSkillsStore } from '../src/lib/agent/skill-store/skills-s3'
import { closeDb, connectDb } from '../src/lib/db'

import type { SkillMutationEvent } from '../src/lib/agent/skill-store/metadata'

type Args = { olderThanMinutes: number; limit: number; dryRun: boolean }

function parseArgs(): Args {
  const args: Args = { olderThanMinutes: 10, limit: 100, dryRun: false }
  const argv = process.argv.slice(2)

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]

    if (arg === '--older-than-minutes') args.olderThanMinutes = Number(argv[++i])
    else if (arg === '--limit') args.limit = Number(argv[++i])
    else if (arg === '--dry-run') args.dryRun = true
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'usage: bun scripts/reconcile-skill-mutations.ts [--older-than-minutes 10] [--limit 100] [--dry-run]',
      )
      process.exit(0)
    } else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!Number.isFinite(args.olderThanMinutes) || args.olderThanMinutes < 1) {
    throw new Error('--older-than-minutes must be at least 1')
  }
  if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 1000) {
    throw new Error('--limit must be an integer from 1 to 1000')
  }

  return args
}

function sameEtags(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a).sort()
  const bKeys = Object.keys(b).sort()

  return (
    aKeys.length === bKeys.length &&
    aKeys.every((key, index) => key === bKeys[index] && a[key] === b[key])
  )
}

async function staleIntents(before: Date, limit: number): Promise<SkillMutationEvent[]> {
  return skillEvents()
    .aggregate<SkillMutationEvent>([
      { $match: { phase: 'intent', status: 'pending', createdAt: { $lte: before } } },
      {
        $lookup: {
          from: SKILL_EVENTS_COLLECTION,
          let: { mutationId: '$mutationId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [{ $eq: ['$mutationId', '$$mutationId'] }, { $eq: ['$phase', 'result'] }],
                },
              },
            },
            { $limit: 1 },
          ],
          as: 'results',
        },
      },
      { $match: { results: { $eq: [] } } },
      { $unset: 'results' },
      { $sort: { createdAt: 1, _id: 1 } },
      { $limit: limit },
    ])
    .toArray()
}

async function main(): Promise<void> {
  const args = parseArgs()

  await connectDb()
  try {
    const before = new Date(Date.now() - args.olderThanMinutes * 60_000)
    const intents = await staleIntents(before, args.limit)
    const repository = skillMetadataRepository()

    for (const intent of intents) {
      const s3 = getSkillsStore({ scope: intent.scope })
      const objects = await s3.listUnderPrefix(`${intent.scope}/skills/${intent.skillName}/`)
      const afterEtags = Object.fromEntries(
        objects.map((object) => [object.key.slice(intent.scope.length + 1), object.etag]),
      )
      const base = {
        mutationId: intent.mutationId,
        scope: intent.scope,
        skillName: intent.skillName,
        action: intent.action,
        actor: {
          userId: intent.actorUserId,
          source: intent.source,
          requestId: intent.requestId,
          conversationId: intent.conversationId,
          toolCallId: intent.toolCallId,
        },
        changedKeys: intent.changedKeys,
        beforeEtags: intent.beforeEtags,
      }

      if (sameEtags(intent.beforeEtags, afterEtags)) {
        console.log(`${args.dryRun ? 'would fail' : 'fail'} ${intent.mutationId}: no S3 change`)
        if (!args.dryRun) {
          await repository.fail({
            ...base,
            error: 'Reconciled stale intent: no S3 state change detected',
          })
        }
        continue
      }

      const expectedApplied =
        intent.action === 'delete_skill'
          ? objects.length === 0
          : intent.action === 'delete_object'
            ? intent.changedKeys.every((key) => !(key in afterEtags))
            : intent.changedKeys.every((key) => key in afterEtags)
      const status = expectedApplied ? 'applied' : 'partial'
      const error = expectedApplied
        ? null
        : 'Reconciled stale intent: S3 contains only part of the requested state'

      console.log(
        `${args.dryRun ? 'would mark' : 'mark'} ${intent.mutationId} ${status} (${intent.scope}/skills/${intent.skillName})`,
      )
      if (!args.dryRun) {
        await repository.complete({
          ...base,
          status,
          recordStatus: objects.length > 0 ? 'active' : 'deleted',
          createdNew: intent.action === 'create' && Object.keys(intent.beforeEtags).length === 0,
          afterEtags,
          error,
        })
      }
    }

    console.log(`${args.dryRun ? 'dry-run' : 'done'}: ${intents.length} stale intent(s)`)
  } finally {
    await closeDb()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
