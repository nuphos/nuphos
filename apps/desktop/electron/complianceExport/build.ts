import { createHash } from 'node:crypto'

import { complianceReadme, verifierScript } from './static-content.ts'

import type { AgentAuditUser, AgentComplianceExportBundle, AgentJournalEvent } from '../agent.ts'

export type ComplianceExportFile = { name: string; content: string }

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function csvCell(value: unknown): string {
  let text = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value)

  // Auditors commonly open CSV files in Excel/Sheets. Prevent user-controlled
  // titles, names, or redacted inputs from becoming executable formulas.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`

  return `"${text.replaceAll('"', '""')}"`
}

function csv(rows: unknown[][]): string {
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}

function userLabel(users: Record<string, AgentAuditUser>, userId: string | null): string {
  if (!userId) return 'System / import'
  const user = users[userId]

  return user?.name || user?.username || userId
}

function eventDetails(event: AgentJournalEvent): {
  action: unknown
  resource: unknown
  result: unknown
  authorization: unknown
  identities: unknown
} {
  const payload = event.payload ?? {}

  return {
    action: payload.toolName ?? payload.decision ?? event.type,
    resource: payload.inputRedacted ?? null,
    result: payload.success ?? payload.status ?? payload.finishReason ?? null,
    authorization: payload.authorization ?? null,
    identities: payload.access ?? null,
  }
}

function safeName(value: string): string {
  const readable = value.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 100) || 'session'

  return `${readable}-${createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 10)}`
}

export function buildComplianceExportFiles(
  bundle: AgentComplianceExportBundle,
): ComplianceExportFile[] {
  const sessionFiles = bundle.sessions.map((session) => ({
    name: `evidence/sessions/${safeName(session.sessionId)}.json`,
    content: json(session),
  }))
  const sessionSummary = bundle.sessions.map((session, index) => ({
    sessionId: session.sessionId,
    evidenceFile: sessionFiles[index].name,
    title: session.title,
    ownerUserId: session.ownerUserId,
    actors: session.actors,
    firstEventAt: session.firstEventAt,
    lastEventAt: session.lastEventAt,
    integrity: session.integrity,
  }))
  const agentRows: unknown[][] = [
    [
      'timestamp',
      'session_id',
      'conversation',
      'sequence',
      'actor_user_id',
      'actor',
      'event_type',
      'action',
      'resource_or_redacted_input',
      'result',
      'authorization',
      'obtained_identities',
      'request_id',
      'tool_call_id',
      'payload_hash',
      'previous_hash',
      'entry_hash',
      'integrity_level',
    ],
  ]

  for (const session of bundle.sessions) {
    for (const event of session.events) {
      const details = eventDetails(event)

      agentRows.push([
        event.ts,
        session.sessionId,
        session.title,
        event.seq,
        event.actor.userId,
        userLabel(bundle.users, event.actor.userId),
        event.type,
        details.action,
        details.resource,
        details.result,
        details.authorization,
        details.identities,
        event.session.requestId,
        event.session.toolCallId,
        event.payloadHash,
        event.prevHash,
        event.entryHash,
        session.integrity.level,
      ])
    }
  }

  const resourceRows: unknown[][] = [
    [
      'timestamp',
      'actor_user_id',
      'actor',
      'resource_kind',
      'resource_scope',
      'resource_name',
      'action',
      'status',
      'source',
      'changed_keys',
      'conversation_id',
      'tool_call_id',
      'error',
    ],
  ]

  for (const event of bundle.resourceEvents) {
    resourceRows.push([
      event.ts,
      event.actor.userId,
      userLabel(bundle.users, event.actor.userId),
      event.resource.kind,
      event.resource.scope,
      event.resource.name,
      event.mutation.action,
      event.mutation.status,
      event.mutation.source,
      event.mutation.changedKeys,
      event.mutation.conversationId,
      event.mutation.toolCallId,
      event.mutation.error,
    ])
  }

  const payloadFiles: ComplianceExportFile[] = [
    { name: 'README.txt', content: complianceReadme() },
    { name: 'audit-events.csv', content: csv(agentRows) },
    { name: 'resource-events.csv', content: csv(resourceRows) },
    { name: 'evidence/resource-events.json', content: json(bundle.resourceEvents) },
    { name: 'verify.mjs', content: verifierScript() },
    ...sessionFiles,
  ]
  const manifest = {
    schemaVersion: bundle.schemaVersion,
    generatedAt: bundle.generatedAt,
    generatedByUserId: bundle.generatedByUserId,
    generatedBy: userLabel(bundle.users, bundle.generatedByUserId),
    scope: bundle.scope,
    teamId: bundle.teamId,
    filters: bundle.filters,
    selection: bundle.selection,
    sessions: sessionSummary,
    files: payloadFiles.map((file) => ({
      name: file.name,
      bytes: Buffer.byteLength(file.content, 'utf8'),
      sha256: createHash('sha256').update(file.content, 'utf8').digest('hex'),
    })),
    evidenceModel: {
      sessionEvents:
        'Complete per-session SHA-256 hash chains, recomputed by Nuphos at export time.',
      resourceEvents:
        'Supplementary append-only resource mutation records; not members of a session hash chain.',
      displayedContent: 'Hash-exempt conversation display copies are intentionally omitted.',
    },
    trustBoundary: {
      authentication: 'unsigned-self-contained',
      limitation:
        'Verification proves package consistency, not origin or resistance to a full malicious rebuild.',
      followUp: 'https://linear.app/zeabur/issue/NUPS-436',
    },
  }
  const files: ComplianceExportFile[] = [
    payloadFiles[0],
    { name: 'manifest.json', content: json(manifest) },
    ...payloadFiles.slice(1),
  ]
  const sums = files
    .map(
      (file) => `${createHash('sha256').update(file.content, 'utf8').digest('hex')}  ${file.name}`,
    )
    .join('\n')

  files.push({ name: 'SHA256SUMS.txt', content: `${sums}\n` })

  return files
}
