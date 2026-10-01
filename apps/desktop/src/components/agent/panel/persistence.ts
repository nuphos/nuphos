import { isAgentMemoryIngestEventItem } from './memoryIngestEvent'
import { normalizeMemoryProvenanceLabels } from './memoryProvenanceLabels'
import { parseSteeringPart } from './steering'
import { toPersistedMessages } from './toUiMessages'
import { normalizeTurnInterruptedPart } from './turnInterrupted'

import type { Message, Tab } from './model'
import type { Part, ToolPart } from './parts'
import type { AgentPersistedMessage } from '../../../api'

export function normalizePersistedPart(part: unknown): Part | null {
  if (!part || typeof part !== 'object') return null
  const value = part as Record<string, unknown>

  if (value.type === 'text' && typeof value.text === 'string') {
    return { type: 'text', text: value.text }
  }
  if (value.type === 'reasoning' && typeof value.text === 'string') {
    return {
      type: 'reasoning',
      text: value.text,
      ...(typeof value.startedAt === 'number' ? { startedAt: value.startedAt } : {}),
      ...(typeof value.completedAt === 'number' ? { completedAt: value.completedAt } : {}),
    }
  }
  if (value.type === 'local-file' && typeof value.path === 'string') {
    return { type: 'local-file', path: value.path }
  }
  if (
    value.type === 'image' &&
    typeof value.url === 'string' &&
    typeof value.mediaType === 'string'
  ) {
    return {
      type: 'image',
      url: value.url,
      mediaType: value.mediaType,
      fileName: typeof value.fileName === 'string' ? value.fileName : 'image',
      ...(typeof value.path === 'string' ? { path: value.path } : {}),
      // Keep the attachmentId so on-demand upload still works after reopening a
      // chat within the same session (the main-process registry is still live).
      // After an app restart the registry is empty, and upload_attachment returns
      // a clear "re-attach" error — graceful, not a false promise.
      ...(typeof value.attachmentId === 'string' ? { attachmentId: value.attachmentId } : {}),
    }
  }
  if (
    value.type === 'transfer-upload' &&
    typeof value.groupId === 'string' &&
    Array.isArray(value.files)
  ) {
    return {
      type: 'transfer-upload',
      groupId: value.groupId,
      // Persisted uploads have always finished; default a missing/unknown status
      // to 'ready' rather than leaving the card stuck in a loading spinner.
      status: value.status === 'uploading' || value.status === 'error' ? value.status : 'ready',
      ...(value.archive === true ? { archive: true } : {}),
      ...(typeof value.archiveEntryCount === 'number'
        ? { archiveEntryCount: value.archiveEntryCount }
        : {}),
      files: (value.files as unknown[]).map((f) => {
        const o = (f ?? {}) as Record<string, unknown>

        return {
          fileName: typeof o.fileName === 'string' ? o.fileName : '',
          size: typeof o.size === 'number' ? o.size : null,
          status: typeof o.status === 'string' ? o.status : 'ready',
        }
      }),
    }
  }
  if (value.type === 'step-start') return { type: 'step-start' }
  if (
    value.type === 'tool' &&
    typeof value.toolCallId === 'string' &&
    typeof value.toolName === 'string' &&
    (value.state === 'input-streaming' ||
      value.state === 'input-available' ||
      value.state === 'approval-requested' ||
      value.state === 'approval-responded' ||
      value.state === 'output-available' ||
      value.state === 'output-error')
  ) {
    return {
      type: 'tool',
      toolCallId: value.toolCallId,
      toolName: value.toolName,
      state: value.state,
      ...(typeof value.startedAt === 'number' ? { startedAt: value.startedAt } : {}),
      ...(typeof value.completedAt === 'number' ? { completedAt: value.completedAt } : {}),
      ...(value.input !== undefined ? { input: value.input } : {}),
      ...(value.output !== undefined ? { output: value.output } : {}),
      ...(typeof value.errorText === 'string' ? { errorText: value.errorText } : {}),
      ...(value.approval && typeof value.approval === 'object'
        ? { approval: value.approval as ToolPart['approval'] }
        : {}),
      ...(value.authorization && typeof value.authorization === 'object'
        ? { authorization: value.authorization as ToolPart['authorization'] }
        : {}),
    }
  }
  if (
    typeof value.type === 'string' &&
    value.type.startsWith('tool-') &&
    typeof value.toolCallId === 'string' &&
    (value.state === 'input-streaming' ||
      value.state === 'input-available' ||
      value.state === 'approval-requested' ||
      value.state === 'approval-responded' ||
      value.state === 'output-available' ||
      value.state === 'output-error')
  ) {
    return {
      type: 'tool',
      toolCallId: value.toolCallId,
      toolName: value.type.slice('tool-'.length),
      state: value.state,
      ...(typeof value.startedAt === 'number' ? { startedAt: value.startedAt } : {}),
      ...(typeof value.completedAt === 'number' ? { completedAt: value.completedAt } : {}),
      ...(value.input !== undefined ? { input: value.input } : {}),
      ...(value.output !== undefined ? { output: value.output } : {}),
      ...(typeof value.errorText === 'string' ? { errorText: value.errorText } : {}),
      ...(value.approval && typeof value.approval === 'object'
        ? { approval: value.approval as ToolPart['approval'] }
        : {}),
      ...(value.authorization && typeof value.authorization === 'object'
        ? { authorization: value.authorization as ToolPart['authorization'] }
        : {}),
    }
  }
  if (
    value.type === 'memory-ingest' &&
    typeof value.id === 'string' &&
    typeof value.sessionId === 'string' &&
    (value.kind === 'ok' || value.kind === 'skipped' || value.kind === 'error') &&
    typeof value.text === 'string' &&
    typeof value.createdAt === 'string'
  ) {
    const memories = Array.isArray(value.memories)
      ? value.memories.filter(isAgentMemoryIngestEventItem)
      : undefined

    if (value.text.toLowerCase().includes('queued')) return null

    return {
      type: 'memory-ingest',
      id: value.id,
      sessionId: value.sessionId,
      kind: value.kind,
      text: value.text,
      createdAt: value.createdAt,
      ...(memories ? { memories } : {}),
      ...(typeof value.detailsLoadedAt === 'string'
        ? { detailsLoadedAt: value.detailsLoadedAt }
        : {}),
    }
  }
  if (
    value.type === 'memory-provenance' &&
    typeof value.id === 'string' &&
    typeof value.sessionId === 'string' &&
    Array.isArray(value.personalIds) &&
    Array.isArray(value.teamIds) &&
    typeof value.createdAt === 'string'
  ) {
    const strs = (a: unknown) =>
      (Array.isArray(a) ? a : []).filter((x): x is string => typeof x === 'string')
    const labels = normalizeMemoryProvenanceLabels(value.labels)

    return {
      type: 'memory-provenance',
      id: value.id,
      sessionId: value.sessionId,
      personalIds: strs(value.personalIds),
      teamIds: strs(value.teamIds),
      fetchedIds: strs((value as { fetchedIds?: unknown }).fetchedIds),
      fetchedCount: typeof value.fetchedCount === 'number' ? value.fetchedCount : 0,
      ...('fetchedPersonalIds' in value
        ? {
            fetchedPersonalIds: strs(
              (value as { fetchedPersonalIds?: unknown }).fetchedPersonalIds,
            ),
          }
        : {}),
      ...('fetchedTeamIds' in value
        ? { fetchedTeamIds: strs((value as { fetchedTeamIds?: unknown }).fetchedTeamIds) }
        : {}),
      createdAt: value.createdAt,
      ...(typeof (value as { deliveryMode?: unknown }).deliveryMode === 'string'
        ? { deliveryMode: (value as { deliveryMode: string }).deliveryMode }
        : {}),
      ...(typeof (value as { turnKey?: unknown }).turnKey === 'string'
        ? { turnKey: (value as { turnKey: string }).turnKey }
        : {}),
      ...(labels ? { labels } : {}),
      ...(typeof value.teamId === 'string' ? { teamId: value.teamId } : {}),
    }
  }
  if (value.type === 'data-steering') return parseSteeringPart(value)
  if (value.type === 'turn-interrupted') return normalizeTurnInterruptedPart(value)

  return null
}

export function fromPersistedMessages(messages: AgentPersistedMessage[]): Message[] {
  return messages
    .map((message): Message | null => {
      const parts = message.parts
        .map(normalizePersistedPart)
        .filter((part): part is Part => part !== null)

      if (parts.length === 0) return null
      const createdAt = message.createdAt ? Date.parse(message.createdAt) : NaN

      return {
        id: message.id,
        role: message.role,
        parts,
        ...(message.metadata?.version === 1 ? { metadata: message.metadata } : {}),
        ...(message.turnOrigin === 'autonomous' ? { turnOrigin: 'autonomous' as const } : {}),
        ...(message.turnKind === 'plan-approval' ? { turnKind: 'plan-approval' as const } : {}),
        ...(message.stoppedByUser === true ? { stoppedByUser: true } : {}),
        ...(Number.isFinite(createdAt) ? { createdAt } : {}),
        ...(message.feedback ? { feedback: message.feedback } : {}),
      }
    })
    .filter((message): message is Message => message !== null)
}

export function transcriptSignature(tab: Pick<Tab, 'sessionId' | 'title' | 'messages'>): string {
  return JSON.stringify({
    sessionId: tab.sessionId,
    title: tab.title,
    messages: toPersistedMessages(tab.messages),
  })
}
