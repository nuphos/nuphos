#!/usr/bin/env bun
// Register S3-only skill packages as legacy provenance records. This never
// invents a creator or creation time and never overwrites tracked records.

import { backfillLegacySkillRecord, getSkillRecord } from '../src/lib/agent/skill-store/metadata'
import { normalizeSkillScope } from '../src/lib/agent/skill-store/scope'
import {
  groupSkillObjects,
  listSkillObjects,
  listSkillScopes,
} from '../src/lib/agent/skill-store/service'
import { closeDb, connectDb } from '../src/lib/db'

type Args = { scope?: string; dryRun: boolean }

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const args: Args = { dryRun: false }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]

    if (arg === '--scope') args.scope = normalizeSkillScope(argv[++i] ?? '')
    else if (arg === '--dry-run') args.dryRun = true
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'usage: bun scripts/backfill-skill-metadata.ts [--scope global|teams/<teamId>] [--dry-run]',
      )
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return args
}

async function main(): Promise<void> {
  const args = parseArgs()

  await connectDb()
  try {
    const scopes = args.scope ? [args.scope] : await listSkillScopes()
    let inserted = 0
    let existing = 0

    for (const scope of scopes) {
      const listing = await listSkillObjects(scope)

      if (listing.truncated) {
        throw new Error(
          `Scope ${scope} exceeds the ${listing.limit}-object listing limit; refusing a partial backfill`,
        )
      }
      const { skills } = groupSkillObjects(listing.objects)

      for (const skill of skills) {
        if (await getSkillRecord(scope, skill.name)) {
          existing += 1
          continue
        }
        const lastModifiedRaw = skill.files
          .map((file) => file.lastModified)
          .filter((value): value is string => Boolean(value))
          .sort()
          .pop()
        const lastModified = lastModifiedRaw ? new Date(lastModifiedRaw) : null

        console.log(
          `${args.dryRun ? 'would register' : 'register'} ${scope}/skills/${skill.name} as legacy`,
        )
        if (!args.dryRun) {
          const created = await backfillLegacySkillRecord({
            scope,
            name: skill.name,
            lastModified,
          })

          if (created) inserted += 1
          else existing += 1
        } else {
          inserted += 1
        }
      }
    }

    console.log(
      `${args.dryRun ? 'dry-run' : 'done'}: ${inserted} legacy record(s), ${existing} already tracked`,
    )
  } finally {
    await closeDb()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
