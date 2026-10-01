import { readBoundedBody } from '@/lib/agent/inbound-files'
import { AppError } from '@/lib/errors'
import { logError, logEvent } from '@/lib/observability'
import { postSlackMessage, slackApi, slackApiGet } from '@/lib/slack/api'

import type { TransferGroupView } from '@/lib/file-transfer/service'

// ─── Slack file attachments ──────────────────────────────────────────────────
// Files the agent pushes to the transfer store during a turn (download groups)
// are mirrored into the Slack thread as native attachments via the external
// upload flow: files.getUploadURLExternal → POST the bytes →
// files.completeUploadExternal (which shares into the thread). Requires the
// files:write bot scope; workspaces installed before that scope was added get
// a plain-message fallback pointing at the Nuphos desktop download card.

// Whole files are buffered through this process on their way to Slack, so cap
// what we attach. Slack's own ceiling is 1 GB; the transfer store's default
// per-file cap is 100 MB — anything bigger stays a desktop-only download.
// Buffering (vs streaming the S3 body into the upload POST) is a deliberate
// trade-off: fetch request-body streaming is not reliably supported in this
// runtime, files upload sequentially per turn, and the worst case is bounded
// by this cap times concurrent turns. Revisit if that ever shows up in heap
// telemetry.
const SLACK_ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024

// Presigned S3 GET + Slack upload POST are both bulk transfers; give them a
// longer leash than the 10s JSON API timeout.
const FILE_TRANSFER_TIMEOUT_MS = 120_000

export async function uploadBytesToSlackThread(args: {
  token: string
  channel: string
  threadTs: string
  fileName: string
  bytes: Uint8Array
}): Promise<void> {
  const granted = await slackApiGet(args.token, 'files.getUploadURLExternal', {
    filename: args.fileName,
    length: args.bytes.byteLength,
  })

  if (!granted.upload_url || !granted.file_id) {
    throw new AppError(502, 'slack_api_error', 'files.getUploadURLExternal returned no upload URL')
  }
  const posted = await fetch(granted.upload_url, {
    method: 'POST',
    signal: AbortSignal.timeout(FILE_TRANSFER_TIMEOUT_MS),
    headers: { 'content-type': 'application/octet-stream' },
    body: args.bytes,
  })

  if (!posted.ok) {
    throw new AppError(
      502,
      'slack_api_error',
      `Slack upload URL rejected ${args.fileName}: HTTP ${String(posted.status)}`,
    )
  }
  await slackApi(args.token, 'files.completeUploadExternal', {
    files: [{ id: granted.file_id, title: args.fileName }],
    channel_id: args.channel,
    thread_ts: args.threadTs,
  })
}

// Bounded like the inbound path: the item's recorded size is checked before
// this call, but that is metadata — enforcing the cap while reading is what
// actually keeps an unexpected body out of the worker's memory.
async function fetchTransferBytes(url: string, maxBytes: number): Promise<Uint8Array> {
  const response = await fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(FILE_TRANSFER_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new AppError(
      502,
      'transfer_fetch_failed',
      `Transfer download failed: HTTP ${String(response.status)}`,
    )
  }
  const bytes = await readBoundedBody(response, maxBytes)

  if (!bytes) {
    throw new AppError(
      413,
      'transfer_too_large',
      'Transfer download exceeded the attachment size limit',
    )
  }

  return bytes
}

function isMissingScopeError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('missing_scope')
}

// Attaches every ready file of the given transfer groups to the thread.
// Best-effort per file: one failed attachment must not drop the rest, and
// whatever could not be attached (too large, fetch/upload failure, missing
// files:write scope) is summarized in a single fallback message pointing at
// the desktop download card. Never throws.
export async function shareTransferGroupsToSlackThread(args: {
  token: string
  channel: string
  threadTs: string
  groups: TransferGroupView[]
}): Promise<void> {
  // Only ready files are mirrored — no retry for groups still mid-upload when
  // the turn ends. That's by design: the file-transfer skill requires the
  // agent to push AND finalize within the turn (the sandbox may not outlive
  // it), so a non-ready item here is a failed or abandoned push, and the
  // desktop download card remains the source of truth either way.
  const files = args.groups.flatMap((group) =>
    group.files
      .filter((file) => file.status === 'ready' && file.downloadUrl)
      .map((file) => ({ groupId: group.groupId, ...file })),
  )

  if (files.length === 0) return

  const unattached: { fileName: string; reason: 'too_large' | 'failed' }[] = []
  let missingScope = false

  for (const [index, file] of files.entries()) {
    if (missingScope) {
      // The bot token predates files:write; no upload can succeed, so the
      // rest goes straight to the fallback message.
      unattached.push({ fileName: file.fileName, reason: 'failed' })
      continue
    }
    if ((file.size ?? 0) > SLACK_ATTACHMENT_MAX_BYTES) {
      unattached.push({ fileName: file.fileName, reason: 'too_large' })
      continue
    }
    try {
      const bytes = await fetchTransferBytes(file.downloadUrl!, SLACK_ATTACHMENT_MAX_BYTES)

      await uploadBytesToSlackThread({
        token: args.token,
        channel: args.channel,
        threadTs: args.threadTs,
        fileName: file.fileName,
        bytes,
      })
      logEvent('info', 'slack.files.attached', {
        slack_channel_id: args.channel,
        slack_thread_ts: args.threadTs,
        transfer_group_id: file.groupId,
        file_name: file.fileName,
        size: bytes.byteLength,
      })
    } catch (err) {
      if (isMissingScopeError(err)) {
        missingScope = true
        logEvent('warn', 'slack.files.missing_scope', {
          slack_channel_id: args.channel,
          transfer_group_id: file.groupId,
          remaining_files: files.length - index,
        })
      } else {
        logError('slack.files.attach_error', err, {
          slack_channel_id: args.channel,
          slack_thread_ts: args.threadTs,
          transfer_group_id: file.groupId,
          file_name: file.fileName,
        })
      }
      unattached.push({ fileName: file.fileName, reason: 'failed' })
    }
  }
  if (unattached.length === 0) return

  const names = unattached.map((entry) =>
    entry.reason === 'too_large' ? `\`${entry.fileName}\` (too large)` : `\`${entry.fileName}\``,
  )
  const scopeHint = missingScope
    ? ' Attaching files in Slack requires re-installing the Nuphos Slack app (files permission).'
    : ''

  try {
    await postSlackMessage({
      token: args.token,
      channel: args.channel,
      threadTs: args.threadTs,
      text: `📎 This run produced files I couldn't attach here: ${names.join(', ')}. Download them from this conversation in the Nuphos desktop app.${scopeHint}`,
    })
  } catch (err) {
    logError('slack.files.fallback_error', err, {
      slack_channel_id: args.channel,
      slack_thread_ts: args.threadTs,
    })
  }
}
