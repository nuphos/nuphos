import {
  INBOUND_FILE_FAILURE_NOTE,
  ingestInboundFiles,
  renderInboundFileInstruction,
  renderInboundImagePart,
} from '@/lib/agent/inbound-files'
import { downloadLarkMessageResource } from '@/lib/lark/api'
import { logError, logEvent } from '@/lib/observability'

import type { InboundFile } from '@/lib/agent/inbound-files'
import type { LarkAppContext } from '@/lib/lark/api'

// A Lark attachment above this stays pull-only from the transfer store; the
// store's own ceilings still apply on top (config.fileTransfer).
const MAX_LARK_ATTACHMENT_BYTES = 25 * 1024 * 1024

// Attachments a Lark message carries. `image` messages hold an image_key,
// `file`/`audio`/`media` hold a file_key plus (for file) the original name.
export function parseLarkAttachments(message: {
  message_type?: string
  content?: string
}): { key: string; type: 'image' | 'file'; fileName: string }[] {
  if (typeof message.content !== 'string') return []
  let parsed: Record<string, unknown>

  try {
    parsed = JSON.parse(message.content) as Record<string, unknown>
  } catch {
    return []
  }
  const imageKey = typeof parsed.image_key === 'string' ? parsed.image_key : null

  if (message.message_type === 'image' && imageKey) {
    return [{ key: imageKey, type: 'image', fileName: `${imageKey}.png` }]
  }
  const fileKey = typeof parsed.file_key === 'string' ? parsed.file_key : null

  if (!fileKey) return []
  if (!['file', 'audio', 'media'].includes(message.message_type ?? '')) return []
  const fileName =
    typeof parsed.file_name === 'string' && parsed.file_name.trim()
      ? parsed.file_name.trim()
      : fileKey

  return [{ key: fileKey, type: 'file', fileName }]
}

// Downloads whatever the message carried and puts it in the transfer store, so
// the turn can tell the agent where to pull it from. Never throws: an
// unreadable attachment (most often a custom app without `im:resource`)
// degrades to a note rather than losing the message.
export async function ingestLarkAttachments(args: {
  ctx: LarkAppContext
  message: { message_id?: string; message_type?: string; content?: string }
  teamId: string
  userId: string
  sessionId: string
}): Promise<{ note: string; parts: unknown[] }> {
  const refs = parseLarkAttachments(args.message)

  if (refs.length === 0 || !args.message.message_id) return { note: '', parts: [] }

  const downloaded: InboundFile[] = []
  let failed = 0

  for (const ref of refs) {
    try {
      const file = await downloadLarkMessageResource({
        ctx: args.ctx,
        messageId: args.message.message_id,
        fileKey: ref.key,
        type: ref.type,
        maxBytes: MAX_LARK_ATTACHMENT_BYTES,
      })

      if (!file) {
        failed++
        continue
      }
      downloaded.push({
        fileName: ref.fileName,
        contentType: file.contentType,
        bytes: file.bytes,
      })
    } catch (err) {
      failed++
      logError('lark.files.download.error', err, { lark_file_key: ref.key })
    }
  }

  const ingested = await ingestInboundFiles({
    teamId: args.teamId,
    userId: args.userId,
    sessionId: args.sessionId,
    files: downloaded,
    label: 'Lark attachment',
  })

  logEvent('info', 'lark.agent.attachments_ingested', {
    team_id: args.teamId,
    session_id: args.sessionId,
    attached_count: refs.length,
    stored_count: ingested?.fileNames.length ?? 0,
    failed_count: failed,
  })

  const notes: string[] = []

  if (ingested) notes.push(renderInboundFileInstruction(ingested))
  if (failed > 0 || (downloaded.length > 0 && !ingested)) notes.push(INBOUND_FILE_FAILURE_NOTE)

  return {
    note: notes.join('\n'),
    parts: downloaded
      .map((file) => renderInboundImagePart(file))
      .filter((part): part is NonNullable<typeof part> => part !== null),
  }
}

// ─── Message content parsing ─────────────────────────────────────────────────
export function parseLarkText(message: {
  message_type?: string
  content?: string
  mentions?: { key?: string; name?: string }[]
}): string {
  if (message.message_type !== 'text' || typeof message.content !== 'string') return ''
  let text: string

  try {
    const parsed = JSON.parse(message.content) as { text?: unknown }

    text = typeof parsed.text === 'string' ? parsed.text : ''
  } catch {
    return ''
  }
  for (const mention of message.mentions ?? []) {
    if (!mention.key) continue
    text = text.split(mention.key).join(mention.name ? mention.name : '')
  }

  // Preserve internal newlines/indentation — collapsing whitespace would corrupt
  // pasted commands, YAML, and logs before the agent sees them.
  return text.trim()
}
