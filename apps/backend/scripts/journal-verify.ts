// Audit journal verifier. Recomputes the tamper-evident chains end to end and
// reports in plain language.
//
//   bun scripts/journal-verify.ts                 # every conversation + sealed segments
//   bun scripts/journal-verify.ts --session <id>  # one conversation
//   bun scripts/journal-verify.ts --no-deep       # skip the hot-copy cross-check
//
// Finding severity:
//   HARD  — chain violations (edit/deletion/reorder/forgery), sealed-history
//           divergence, segment chain breaks, missing conversations without a
//           tombstone. These mean tampering (or a bug worth treating as such).
//   SOFT  — hot-copy divergence on UNSEALED history (agent_messages content no
//           longer matches journaled hashes). Legitimate causes exist
//           (compaction, message rewrites), so these warrant investigation,
//           not automatic alarm.
//
// Requires MONGODB_URI; the sealed-segment pass additionally needs
// JOURNAL_S3_BUCKET (+ credentials able to GetObject/ListBucket and, when
// signatures are enabled, kms:Verify).

import { connectDb, closeDb, db } from '../src/lib/db'
import {
  JOURNAL_COLLECTION,
  canonicalize,
  sha256Hex,
  verifyConversationChain,
} from '../src/lib/journal'

import { verifySealedSegments } from './journal-verify-segments'

import type { AuditEvent, JournalDoc } from '../src/lib/journal'

type Finding = { severity: 'HARD' | 'SOFT'; scope: string; message: string }

const args = process.argv.slice(2)
const sessionFilter = args.includes('--session') ? args[args.indexOf('--session') + 1] : null
const deep = !args.includes('--no-deep')

const findings: Finding[] = []
let checkedEvents = 0
let checkedMessages = 0

function report(severity: 'HARD' | 'SOFT', scope: string, message: string) {
  findings.push({ severity, scope, message })
}

function stableSerialize(value: unknown, alg: 'jcs' | 'json'): string {
  if (alg === 'jcs') return canonicalize(value)

  return JSON.stringify(value) ?? String(value)
}

async function verifyHotChains(): Promise<Map<string, AuditEvent[]>> {
  const journal = db().collection<JournalDoc>(JOURNAL_COLLECTION)
  const filter = sessionFilter ? { sessionId: sessionFilter } : {}
  const sessionIds = (await journal.distinct('sessionId', filter)) as string[]
  const bySession = new Map<string, AuditEvent[]>()

  for (const sessionId of sessionIds.sort()) {
    const docs = await journal.find({ sessionId }).sort({ seq: 1 }).toArray()
    const events = docs.map((doc) => {
      const { sessionId: _s, _id, ...event } = doc as JournalDoc & { _id?: unknown }

      return event as AuditEvent
    })

    bySession.set(sessionId, events)
    checkedEvents += events.length
    const result = verifyConversationChain(events)

    for (const violation of result.violations) {
      report('HARD', `conversation ${sessionId}`, `seq ${violation.seq}: ${violation.message}`)
    }
  }

  return bySession
}

async function crossCheckMessages(bySession: Map<string, AuditEvent[]>) {
  const messages = db().collection('agent_messages')

  for (const [sessionId, events] of bySession) {
    for (const event of events) {
      if (event.type !== 'user_message' && event.type !== 'assistant_message') continue
      const messageId = event.eventId.split('|')[2]
      const payload = event.payload as { contentHash?: string; hashAlg?: 'jcs' | 'json' }

      if (!messageId || !payload.contentHash) continue
      checkedMessages += 1
      const doc = await messages.findOne({ sessionId, messageId })

      if (!doc) {
        report(
          'SOFT',
          `conversation ${sessionId}`,
          `message ${messageId}: journaled at seq ${event.seq} but no longer present in agent_messages (compaction/retention? tombstone expected once P2 retention lands)`,
        )
        continue
      }
      const recomputed = sha256Hex(
        stableSerialize((doc as { parts?: unknown[] }).parts ?? [], payload.hashAlg ?? 'jcs'),
      )

      if (recomputed !== payload.contentHash) {
        report(
          'SOFT',
          `conversation ${sessionId}`,
          `message ${messageId}: agent_messages content no longer matches the hash journaled at seq ${event.seq} — the hot copy was modified after journaling`,
        )
      }
    }
  }
}

await connectDb()
try {
  console.log('Nuphos audit journal verification')
  const scope = sessionFilter ? `conversation ${sessionFilter}` : 'all conversations'

  console.log(`scope: ${scope}\n`)

  const bySession = await verifyHotChains()

  console.log(
    `✓ hot chains recomputed: ${bySession.size} conversation(s), ${checkedEvents} event(s)`,
  )

  if (deep) {
    await crossCheckMessages(bySession)
    console.log(`✓ hot-copy cross-check: ${checkedMessages} message hash(es) compared`)
  }

  const checkedSegments = await verifySealedSegments(report)

  if (checkedSegments > 0) console.log(`✓ sealed segments verified: ${checkedSegments}`)

  const hard = findings.filter((f) => f.severity === 'HARD')
  const soft = findings.filter((f) => f.severity === 'SOFT')

  console.log('')
  for (const finding of findings) {
    console.log(
      `${finding.severity === 'HARD' ? '✗ HARD' : '⚠ SOFT'} [${finding.scope}] ${finding.message}`,
    )
  }
  console.log('')
  if (hard.length === 0 && soft.length === 0) {
    console.log('✅ chain intact — no violations, no divergence')
  } else {
    const verdict = hard.length === 0 ? '✅ chain intact' : `❌ ${hard.length} HARD violation(s)`

    console.log(`${verdict}, ${soft.length} soft warning(s)`)
  }
  process.exitCode = hard.length > 0 ? 1 : 0
} finally {
  await closeDb()
}
