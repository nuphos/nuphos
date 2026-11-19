/**
 * Rename Claude Code picker aliases (`default`, `opus`, `sonnet`, …) on
 * historical agent_token_usage rows to the model each session's picker names,
 * the same way new turns are recorded (resolveModelAlias). An alias its picker
 * does not name becomes `unknown`, so no alias is left.
 *
 * DRY RUN BY DEFAULT — it writes nothing unless you pass --apply.
 *
 *   bun run scripts/backfill-model-aliases.ts --rollback /tmp/model-aliases.json
 *   bun run scripts/backfill-model-aliases.ts --apply --rollback /tmp/model-aliases.json
 *
 * --rollback <file> writes every row's original modelId keyed by _id, before
 * any write and also on a dry run, so the rename can be reviewed and reverted
 * row by row; --apply requires it. Idempotent: a renamed row carries a version
 * and is not matched again.
 */
import { writeFileSync } from 'node:fs'

import { getConversationPreviewAttachment } from '@/lib/agent/db'
import { agentTokenUsage } from '@/lib/agent/token-usage-db'
import { refreshConversationTokenUsageSummary } from '@/lib/agent/token-usage-summary'
import { resolveModelAlias } from '@/lib/agent/turn-usage-record'
import { connectDb } from '@/lib/db'

import type { ObjectId } from 'mongodb'

const apply = process.argv.includes('--apply')
const rollbackIndex = process.argv.indexOf('--rollback')
const rollbackFile = rollbackIndex === -1 ? undefined : process.argv[rollbackIndex + 1]

if (apply && !rollbackFile) {
  console.error('--apply needs --rollback <file>')
  process.exit(1)
}

await connectDb()
// One group per session and alias; a model id carries a version, an alias does not.
const groups = await agentTokenUsage()
  .aggregate<{
    _id: { sessionId: string; teamId: string; userId: string; modelId: string }
    ids: ObjectId[]
  }>([
    { $match: { source: 'agent-runtime', provider: 'claude-code', modelId: { $not: /\d/ } } },
    {
      $group: {
        _id: { sessionId: '$sessionId', teamId: '$teamId', userId: '$userId', modelId: '$modelId' },
        ids: { $push: '$_id' },
      },
    },
  ])
  .toArray()
const renames = []
const counts = new Map<string, number>()

for (const { _id, ids } of groups) {
  const attachment = await getConversationPreviewAttachment(_id.sessionId, _id.teamId)
  const modelId = resolveModelAlias(_id.modelId, attachment?.sessionConfig)
  const change = `${_id.modelId} → ${modelId}`

  counts.set(change, (counts.get(change) ?? 0) + ids.length)
  if (modelId !== _id.modelId) renames.push({ ..._id, to: modelId, ids })
}
for (const [change, rows] of counts) console.log(`${change}: ${String(rows)} rows`)

// The rows' original modelId by _id, written before anything else and also on a dry run.
if (rollbackFile)
  writeFileSync(
    rollbackFile,
    JSON.stringify(
      Object.fromEntries(
        renames.flatMap(({ ids, modelId }) => ids.map((id) => [String(id), modelId])),
      ),
    ),
  )
if (apply) {
  for (const { ids, to, sessionId, userId, teamId } of renames) {
    await agentTokenUsage().updateMany({ _id: { $in: ids } }, { $set: { modelId: to } })
    await refreshConversationTokenUsageSummary(sessionId, userId, teamId)
  }
  console.log(
    `renamed ${String(renames.length)} session groups; rollback in ${String(rollbackFile)}`,
  )
} else console.log('dry run: nothing written')

process.exit(0)
