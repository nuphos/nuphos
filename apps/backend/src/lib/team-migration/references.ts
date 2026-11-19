import { sha256 } from './format'
import { importedRows } from './records'
import { invalidArchive } from './zip'

import type { MigrationPart, MigrationManifest } from './format'

type Staged = {
  manifest: MigrationManifest
  paths: Map<MigrationPart, string>
  keys: Map<MigrationPart, Set<string>>
}
const sessions: MigrationPart = 'conversations/sessions.ndjson'
const panels: MigrationPart = 'work/panels.ndjson'
const dashboards: MigrationPart = 'work/dashboards.ndjson'

function requireReference(archive: Staged, part: MigrationPart, value: unknown, field: string) {
  if (typeof value !== 'string' || !archive.keys.get(part)?.has(value))
    invalidArchive(`missing ${field} reference`)
}

export async function checkArchiveReferences(archive: Staged) {
  let team: Record<string, unknown> | undefined

  for await (const row of importedRows(archive.paths.get('team.json')!)) team = row
  if (team?.sourceTeamId !== archive.manifest.sourceTeamId)
    invalidArchive('team id disagrees with manifest')
  const home = team?.homeLayout as { panels?: { panelId: string; dashboardId: string }[] } | null

  for (const panel of home?.panels ?? []) {
    requireReference(archive, dashboards, panel.dashboardId, 'home dashboard')
    requireReference(archive, panels, panel.panelId, 'home panel')
  }
  await checkConversationReferences(archive)
  for (const part of ['conversations/messages.ndjson', 'work/bots.ndjson'] as const) {
    for await (const row of importedRows(archive.paths.get(part)!))
      requireReference(archive, sessions, row.sessionId, 'owning conversation')
  }
  for await (const row of importedRows(archive.paths.get('work/triggers.ndjson')!))
    requireReference(archive, sessions, row.targetSessionId, 'trigger owner')
  for await (const row of importedRows(archive.paths.get('work/plans.ndjson')!)) {
    if (row.sourceConversationId)
      requireReference(archive, sessions, row.sourceConversationId, 'plan source')
  }
  for await (const row of importedRows(archive.paths.get(dashboards)!)) {
    if (row.teamId !== archive.manifest.sourceTeamId)
      invalidArchive('dashboard belongs to another source team')
    for (const panel of row.layout as { panelId: string }[])
      requireReference(archive, panels, panel.panelId, 'dashboard panel')
  }
  for await (const row of importedRows(archive.paths.get(panels)!))
    requireReference(archive, dashboards, row.dashboardId, 'panel dashboard')
  for await (const row of importedRows(archive.paths.get('knowledge/memories.ndjson')!)) {
    if (row.restrictedToSessionId)
      requireReference(archive, sessions, row.restrictedToSessionId, 'restricted memory owner')
    const replacement = row.kind === 'record' ? row.supersededBy : row.supersedesId

    if (replacement !== undefined && typeof replacement !== 'string')
      invalidArchive('invalid memory revision reference')
    if (
      replacement &&
      !archive.keys.get('knowledge/memories.ndjson')?.has(`${String(row.kind)}:${replacement}`)
    )
      invalidArchive('missing memory revision reference')
  }
  const skillNames = archive.keys.get('knowledge/skills.ndjson')!

  for await (const row of importedRows(archive.paths.get('knowledge/skill-files.ndjson')!)) {
    const key = String(row.key)

    if (!skillNames.has(key.split('/')[1]!)) invalidArchive('skill file has no package')
    if (sha256(Buffer.from(String(row.text))) !== row.sha256) invalidArchive('skill hash mismatch')
  }
}

async function checkConversationReferences(archive: Staged) {
  const parents = new Map<string, string>()

  for await (const row of importedRows(archive.paths.get(sessions)!)) {
    if (row.parentSessionId)
      requireReference(archive, sessions, row.parentSessionId, 'parent conversation')
    for (const id of (row.agentSessionIds as string[] | undefined) ?? [])
      requireReference(archive, sessions, id, 'chat Bot')
    if (
      row.kind === 'channel' &&
      (row.agentSessionIds as string[] | undefined)?.some(
        (id) => !archive.keys.get('work/bots.ndjson')?.has(id),
      )
    )
      invalidArchive(
        'group chats can only reference exported Bots; remove Task participants before exporting again',
      )
    if (row.leadAgentSessionId) {
      requireReference(archive, sessions, row.leadAgentSessionId, 'lead Bot')
      if (
        !(row.agentSessionIds as string[] | undefined)?.includes(row.leadAgentSessionId as string)
      )
        invalidArchive('lead Bot is not a chat member')
    }
    if (row.parentSessionId === row.sessionId) invalidArchive('conversation is its own parent')
    if (typeof row.parentSessionId === 'string')
      parents.set(row.sessionId as string, row.parentSessionId)
  }
  const complete = new Set<string>()

  for (const id of parents.keys()) {
    const trail = new Set<string>()
    let current: string | undefined = id

    while (current && !complete.has(current)) {
      if (trail.has(current)) invalidArchive('conversation parent cycle')
      trail.add(current)
      current = parents.get(current)
    }
    for (const visited of trail) complete.add(visited)
  }
}
