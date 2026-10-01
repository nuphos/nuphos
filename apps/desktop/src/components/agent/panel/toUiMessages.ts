import { finalizeIncompleteTools } from './clientTools'
import { isHiddenMemoryIngestPart } from './parts'
import { INTERRUPTED_TOOL_MESSAGE } from './stall'
import { formatLocalFileInstruction } from './textUtils'

import type { Message } from './model'
import type { TextPart } from './parts'
import type { AgentPersistedMessage } from '../../../api'

export function toUiMessages(messages: Message[]): unknown[] {
  return finalizeIncompleteTools(messages, INTERRUPTED_TOOL_MESSAGE)
    .map((m) => {
      const parts = m.parts.flatMap((p) => {
        if (p.type === 'text') return [{ type: 'text', text: p.text }]
        // Thinking from previous turns isn't resent — the API only needs
        // thinking blocks within the live tool loop, which stays server-side.
        if (p.type === 'reasoning') return []
        // Image attachments go to the model as vision: an AI SDK UI
        // `file` part with an image mediaType, which convertToModelMessages
        // forwards as an image block. No sandbox round-trip. When the file is
        // still resolvable (live session), also tell the model it can transfer
        // the actual bytes on demand via upload_attachment.
        if (p.type === 'image') {
          const visionPart = { type: 'file', mediaType: p.mediaType, url: p.url }

          if (!p.attachmentId) return [visionPart]

          return [
            visionPart,
            {
              type: 'text',
              text:
                `[Attached image "${p.fileName}" (attachmentId: ${p.attachmentId}). You can see it above. ` +
                `If the user wants the actual file transferred or saved — e.g. kubectl cp into a pod, or written to disk — ` +
                `call upload_attachment with attachmentId "${p.attachmentId}" to get a transfer groupId, then pull it with the file-transfer skill. ` +
                `Do NOT ask the user to re-upload it.]`,
            },
          ]
        }
        if (p.type === 'local-file') {
          return [
            {
              type: 'text',
              text: formatLocalFileInstruction(
                p.path,
                m.parts
                  .filter((part): part is TextPart => part.type === 'text')
                  .map((part) => part.text)
                  .join('\n'),
              ),
            },
          ]
        }
        if (p.type === 'transfer-upload') {
          // Only ready uploads with a real group id are pullable. Skip optimistic
          // (uploading) or failed parts — otherwise the agent would be told to
          // pull an empty/invalid transfer group (e.g. the user continues after a
          // failure, or reopens a persisted uploading card).
          if ((p.status && p.status !== 'ready') || !p.groupId) return []
          const names = p.files.map((f) => f.fileName).join(', ')

          if (p.archive) {
            const archiveFile = p.files[0]?.fileName ?? 'archive.zip'
            const count = p.archiveEntryCount ?? null
            const inside = count == null ? '' : `, ${String(count)} file(s) inside`

            return [
              {
                type: 'text',
                text:
                  `[The user uploaded a folder as a single archive (${archiveFile}${inside}) ` +
                  `to the Nuphos file-transfer store (transfer group ${p.groupId}). Load the ` +
                  `file-transfer skill and pull-and-extract it into the sandbox — pass --extract ` +
                  `so the archive is unpacked back into its original directory structure: ` +
                  `bash skills/file-transfer/scripts/transfer-pull.sh "$TEAM" ${p.groupId} ./uploads --extract. ` +
                  `The extracted files under ./uploads are what the user wants you to work with.]`,
              },
            ]
          }

          return [
            {
              type: 'text',
              text:
                `[The user uploaded ${String(p.files.length)} file(s) to the Nuphos file-transfer store ` +
                `(transfer group ${p.groupId}): ${names}. To work with them, load the file-transfer ` +
                `skill and pull them into the sandbox: ` +
                `bash skills/file-transfer/scripts/transfer-pull.sh "$TEAM" ${p.groupId} ./uploads]`,
            },
          ]
        }
        // UI-only artifacts; persist locally, but don't send back to the LLM.
        if (p.type === 'memory-ingest') return []
        if (p.type === 'memory-provenance') return []
        if (p.type === 'turn-interrupted') return []
        // Runtime-acknowledged user input must survive subsequent transcript syncs.
        if (p.type === 'data-steering') return [p]
        if (p.type === 'step-start') return [{ type: 'step-start' }]

        return [
          {
            type: `tool-${p.toolName}`,
            toolCallId: p.toolCallId,
            state: p.state,
            ...(p.startedAt !== undefined ? { startedAt: p.startedAt } : {}),
            ...(p.completedAt !== undefined ? { completedAt: p.completedAt } : {}),
            ...(p.input !== undefined ? { input: p.input } : {}),
            ...(p.output !== undefined ? { output: p.output } : {}),
            ...(p.errorText ? { errorText: p.errorText } : {}),
            // Native HITL: the approval envelope must round-trip so the backend's
            // convertToModelMessages turns an approval-responded part into a
            // ToolApprovalResponse and the SDK executes (or denies) the tool.
            ...(p.approval ? { approval: p.approval } : {}),
          },
        ]
      })

      return {
        id: m.id,
        role: m.role,
        parts,
        ...(m.metadata || m.turnOrigin === 'autonomous' || m.turnKind === 'plan-approval'
          ? {
              metadata: {
                ...m.metadata,
                ...(m.turnOrigin === 'autonomous' ? { turnOrigin: 'autonomous' as const } : {}),
                ...(m.turnKind === 'plan-approval' ? { turnKind: 'plan-approval' as const } : {}),
              },
            }
          : {}),
      }
    })
    .filter((m) => m.parts.length > 0)
}

export function toPersistedMessages(messages: Message[]): AgentPersistedMessage[] {
  return messages
    .map((message) => ({
      id: message.id,
      ...(message.metadata ? { metadata: message.metadata } : {}),
      role: message.role,
      parts: message.parts.flatMap((part) => {
        if (part.type === 'memory-ingest' && isHiddenMemoryIngestPart(part)) return []
        if (part.type !== 'tool' || part.liveOutput === undefined) return [part]
        // Running stdout/stderr is replayable transport state, not transcript
        // history. The completed output event supplies the durable tool result.
        const { liveOutput: _liveOutput, ...persisted } = part

        return [persisted]
      }),
      ...(message.turnOrigin === 'autonomous' ? { turnOrigin: 'autonomous' as const } : {}),
      ...(message.turnKind === 'plan-approval' ? { turnKind: 'plan-approval' as const } : {}),
      ...(message.stoppedByUser ? { stoppedByUser: true } : {}),
    }))
    .filter((message) => message.parts.length > 0)
}
