// ─── Lark file attachments (outbound) ────────────────────────────────────────
// Files the agent pushes to the transfer store during a turn (download groups)
// are mirrored into the Lark chat as native attachments: upload the bytes for
// an image_key / file_key, then send a message carrying that key. The Slack
// path (lib/slack/files.ts) is the same shape; only the provider calls differ.
//
// Uploading needs no extra permission beyond `im:message:send_as_bot`, which
// every bound app already has — unlike the inbound direction, which needs
// `im:resource`. Anything that still fails degrades to a plain-text notice
// pointing at the desktop download card, never a failed turn.
import { isImageContentType, readBoundedBody } from '@/lib/agent/inbound-files'
import { replyLarkMessage, uploadLarkFile, uploadLarkImage } from '@/lib/lark/api'
import { logError, logEvent } from '@/lib/observability'

import type { TransferGroupView } from '@/lib/file-transfer/service'
import type { LarkAppContext } from '@/lib/lark/api'

// Whole files are buffered through this process on their way to Lark. Lark's
// own ceiling is 30 MB for im/v1/files; stay under it and let anything bigger
// remain a desktop-only download.
const LARK_ATTACHMENT_MAX_BYTES = 30 * 1024 * 1024

// Presigned S3 GET + the Lark upload POST are both bulk transfers; give them a
// longer leash than the 10s JSON API timeout.
const FILE_TRANSFER_TIMEOUT_MS = 120_000

// Bounded like the inbound path: the item's recorded size is checked before
// this call, but that is metadata — enforcing the cap while reading is what
// actually keeps an unexpected body out of the worker's memory.
async function fetchTransferBytes(url: string, maxBytes: number): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FILE_TRANSFER_TIMEOUT_MS) })

  if (!response.ok) {
    throw new Error(`transfer download failed: HTTP ${String(response.status)}`)
  }
  const bytes = await readBoundedBody(response, maxBytes)

  if (!bytes) throw new Error('transfer download exceeded the attachment size limit')

  return bytes
}

export async function shareTransferGroupsToLarkChat(args: {
  ctx: LarkAppContext
  rootMessageId: string
  replyInThread: boolean
  groups: TransferGroupView[]
}): Promise<void> {
  // Only ready files are mirrored. A non-ready item is a failed or abandoned
  // push (the skill requires the agent to push AND finalize within the turn,
  // since the sandbox may not outlive it), and the desktop download card
  // remains the source of truth either way.
  const files = args.groups.flatMap((group) =>
    group.files
      .filter((file) => file.status === 'ready' && file.downloadUrl)
      .map((file) => ({ groupId: group.groupId, ...file })),
  )

  if (files.length === 0) return

  const unattached: { fileName: string; reason: 'too_large' | 'failed' }[] = []

  for (const file of files) {
    if ((file.size ?? 0) > LARK_ATTACHMENT_MAX_BYTES) {
      unattached.push({ fileName: file.fileName, reason: 'too_large' })
      continue
    }
    try {
      const bytes = await fetchTransferBytes(file.downloadUrl!, LARK_ATTACHMENT_MAX_BYTES)
      // Images go up as images so Lark renders them inline; everything else is
      // a file card.
      const asImage = isImageContentType(file.contentType)
      const key = asImage
        ? await uploadLarkImage({ ctx: args.ctx, bytes, contentType: file.contentType })
        : await uploadLarkFile({
            ctx: args.ctx,
            fileName: file.fileName,
            bytes,
            contentType: file.contentType,
          })

      if (!key) {
        unattached.push({ fileName: file.fileName, reason: 'failed' })
        continue
      }
      await replyLarkMessage({
        ctx: args.ctx,
        messageId: args.rootMessageId,
        msgType: asImage ? 'image' : 'file',
        content: JSON.stringify(asImage ? { image_key: key } : { file_key: key }),
        replyInThread: args.replyInThread,
      })
      logEvent('info', 'lark.files.attached', {
        transfer_group_id: file.groupId,
        file_name: file.fileName,
        size: bytes.byteLength,
        as_image: asImage,
      })
    } catch (err) {
      logError('lark.files.attach_error', err, {
        transfer_group_id: file.groupId,
        file_name: file.fileName,
      })
      unattached.push({ fileName: file.fileName, reason: 'failed' })
    }
  }
  if (unattached.length === 0) return

  const names = unattached.map((entry) =>
    entry.reason === 'too_large' ? `${entry.fileName} (too large)` : entry.fileName,
  )

  try {
    await replyLarkMessage({
      ctx: args.ctx,
      messageId: args.rootMessageId,
      msgType: 'text',
      content: JSON.stringify({
        text: `📎 This run produced files I couldn't attach here: ${names.join(', ')}. Download them from this conversation in the Nuphos desktop app.`,
      }),
      replyInThread: args.replyInThread,
    })
  } catch (err) {
    logError('lark.files.fallback_error', err, { file_count: unattached.length })
  }
}
