/**
 * Backfill historical thread-addressing judgements from Braintrust into the
 * `slack_addressing_verdicts` collection, so the audit trail starts before the
 * live writer shipped.
 *
 * DRY RUN BY DEFAULT — it writes nothing unless you pass --apply.
 *
 *   BRAINTRUST_API_KEY=… MONGODB_URI=… bun run scripts/backfill-addressing-verdicts.ts
 *   BRAINTRUST_API_KEY=… MONGODB_URI=… bun run scripts/backfill-addressing-verdicts.ts --apply
 *
 * Flags:
 *   --apply             actually write (otherwise: report only)
 *   --project-id <id>   Braintrust project id (default: atlas-backend prod)
 *   --page-size <n>     spans fetched per btql request (default 500)
 *
 * Reads every `thread_addressing.judge` span from project_logs, oldest first,
 * paginating on `created` until exhausted. Idempotent: rows upsert on
 * `dedupeKey = braintrust:<spanId>` with $setOnInsert, so re-running (and
 * overlapping with live rows, which key on the Slack event id instead) never
 * duplicates or overwrites. Old spans carry no channel/thread ids in metadata,
 * so those fields stay empty; alert/pending flags and the incoming message are
 * recovered from the prompt text itself, which the span stores verbatim.
 */
import { config } from '@/config'
import { parseThreadAddressingResponse } from '@/lib/agent/thread-addressing-core'
import { connectDb } from '@/lib/db'
import { slackAddressingVerdicts } from '@/lib/slack/agent-bot/collections'

import type { SlackAddressingVerdict } from '@/lib/slack/agent-bot/collections'
import type { AnyBulkWriteOperation } from 'mongodb'

const DEFAULT_PROJECT_ID = '631f0a0f-539d-4a9f-82b5-0e7810e2eb39'
const SPAN_NAME = 'thread_addressing.judge'

// Markers buildThreadAddressingPrompt writes into the prompt; the only record
// of these flags an old span has.
const ALERT_MARKER = 'This thread started as an alert the agent itself posted.'
const DECISION_MARKER = 'The agent is WAITING ON A DECISION in this thread'
const INCOMING_HEADER = '## Newest message — judge THIS one\n'

function flagValue(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)

  return index === -1 ? undefined : process.argv[index + 1]
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

type SpanRow = {
  id: string
  created: string
  input?: unknown
  output?: unknown
  metadata?: Record<string, unknown>
}

async function fetchSpanPage(args: {
  apiKey: string
  projectId: string
  /** Inclusive lower bound; boundary rows are deduped by the caller. */
  createdFrom: string | null
  limit: number
}): Promise<SpanRow[]> {
  const filters = [`span_attributes.name = '${SPAN_NAME}'`]

  if (args.createdFrom) filters.push(`created >= '${args.createdFrom}'`)
  const query = [
    'select: id, created, input, output, metadata',
    `from: project_logs('${args.projectId}')`,
    `filter: ${filters.join(' and ')}`,
    'sort: created asc',
    `limit: ${String(args.limit)}`,
  ].join(' | ')
  const response = await fetch('https://api.braintrust.dev/btql', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${args.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query, fmt: 'json' }),
  })

  if (!response.ok) {
    throw new Error(`btql request failed (${String(response.status)}): ${await response.text()}`)
  }
  const body = (await response.json()) as { data?: SpanRow[] }

  return body.data ?? []
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function toVerdictDoc(row: SpanRow): Omit<SlackAddressingVerdict, '_id'> | null {
  const prompt = asString(row.input)

  // The span's input IS the prompt; without it the row is useless for the
  // purpose of this collection (prompt iteration), so skip rather than invent.
  if (!prompt) return null
  const rawOutput = asString(row.output)
  const parsed = rawOutput ? parseThreadAddressingResponse(rawOutput) : null
  const metadata = row.metadata ?? {}
  const incomingSection = prompt.split(INCOMING_HEADER)[1]?.trim() ?? ''
  const separator = incomingSection.indexOf(': ')
  const senderName = separator > 0 ? incomingSection.slice(0, separator) : undefined
  const incomingText = separator > 0 ? incomingSection.slice(separator + 2) : incomingSection

  return {
    dedupeKey: `braintrust:${row.id}`,
    source: 'braintrust_backfill',
    braintrustSpanId: row.id,
    ...(asString(metadata.sessionId) ? { sessionId: asString(metadata.sessionId) } : {}),
    ...(asString(metadata.teamId) ? { teamId: asString(metadata.teamId) } : {}),
    ...(asString(metadata.slackChannelId)
      ? { slackChannelId: asString(metadata.slackChannelId) }
      : {}),
    ...(asString(metadata.slackThreadTs)
      ? { slackThreadTs: asString(metadata.slackThreadTs) }
      : {}),
    addressed: parsed?.addressed ?? null,
    failOpen: parsed === null,
    ...(parsed?.reason ? { reason: parsed.reason } : {}),
    ...(rawOutput ? { rawOutput } : {}),
    pendingDecision: prompt.includes(DECISION_MARKER),
    alertThread: prompt.includes(ALERT_MARKER),
    ...(senderName ? { senderName } : {}),
    incomingText,
    prompt,
    modelId: asString(metadata.modelId) ?? 'unknown',
    createdAt: new Date(row.created),
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const projectId = flagValue('project-id') ?? DEFAULT_PROJECT_ID
  const pageSize = Number(flagValue('page-size') ?? '500')

  if (!Number.isSafeInteger(pageSize) || pageSize <= 1) {
    fail('--page-size must be a whole number greater than 1')
  }
  const apiKey = config.agent.braintrustApiKey

  if (!apiKey) fail('BRAINTRUST_API_KEY is not set (config.agent.braintrustApiKey)')

  await connectDb()

  let createdFrom: string | null = null
  // Ids already processed at the current `created` boundary — pages overlap on
  // it on purpose, so spans sharing the boundary timestamp are never dropped.
  let boundaryIds = new Set<string>()
  let scanned = 0
  let skipped = 0
  let upserted = 0
  let alreadyPresent = 0

  for (;;) {
    const page = await fetchSpanPage({ apiKey, projectId, createdFrom, limit: pageSize })
    const rows = page.filter((row) => !boundaryIds.has(row.id))

    if (rows.length === 0) {
      // A full page of already-seen ids means one timestamp holds more spans
      // than a page; advancing createdFrom would silently skip the rest.
      if (page.length === pageSize) {
        fail(
          `more than ${String(pageSize)} spans share created=${String(createdFrom)}; raise --page-size`,
        )
      }
      break
    }

    const operations: AnyBulkWriteOperation<SlackAddressingVerdict>[] = []

    for (const row of rows) {
      scanned++
      const doc = toVerdictDoc(row)

      if (!doc) {
        skipped++
        continue
      }
      operations.push({
        updateOne: {
          filter: { dedupeKey: doc.dedupeKey },
          update: { $setOnInsert: doc },
          upsert: true,
        },
      })
    }

    if (apply && operations.length > 0) {
      const result = await slackAddressingVerdicts().bulkWrite(operations, { ordered: false })

      upserted += result.upsertedCount
      alreadyPresent += operations.length - result.upsertedCount
    } else {
      upserted += operations.length
    }

    const lastCreated = rows[rows.length - 1]!.created

    boundaryIds = new Set(
      [...(lastCreated === createdFrom ? boundaryIds : [])].concat(
        page.filter((row) => row.created === lastCreated).map((row) => row.id),
      ),
    )
    createdFrom = lastCreated
    console.error(`…scanned ${String(scanned)} spans (through ${lastCreated})`)
    if (page.length < pageSize) break
  }

  console.log(
    JSON.stringify(
      {
        mode: apply ? 'apply' : 'dry-run',
        projectId,
        scanned,
        skippedNoPrompt: skipped,
        [apply ? 'upserted' : 'wouldUpsert']: upserted,
        ...(apply ? { alreadyPresent } : {}),
      },
      null,
      2,
    ),
  )
  process.exit(0)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
