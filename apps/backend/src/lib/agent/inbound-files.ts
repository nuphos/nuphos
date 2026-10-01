// Files a user attached to a message on a chat bridge (Slack, Lark), made
// available to the agent.
//
// The contract is the desktop's, not a new one: bytes go into the shared
// file-transfer store as an `upload` group (the direction where the user
// produces and the agent consumes), and the turn carries a text instruction
// naming the transfer group so the agent pulls it into the sandbox with the
// file-transfer skill. Mirrors the `transfer-upload` part the desktop composer
// builds, down to the wording, so one skill serves every surface.
//
// Images additionally ride along as a vision part when they are small enough
// (renderInboundImagePart) — a screenshot dropped into a thread is the case
// this whole path exists for, and making the model pull it before it can look
// at it would be a poor trade. Large images stay pull-only.
import { ObjectId } from 'mongodb'

import { createTransfer, finalizeTransfer } from '@/lib/file-transfer/service'
import { logEvent } from '@/lib/observability'

export type InboundFile = {
  fileName: string
  contentType?: string | null
  bytes: Uint8Array
}

export type IngestedFiles = {
  groupId: string
  fileNames: string[]
}

// Inline vision costs tokens on every replay of the turn and bytes in the
// transcript, so only screenshot-sized images ride along; anything bigger is
// still in the transfer store and one pull away.
const MAX_INLINE_IMAGE_BYTES = 1_500_000

// Matches the outbound side's transfer timeout: these are bulk object-store
// transfers, not JSON calls.
const TRANSFER_PUT_TIMEOUT_MS = 120_000

/**
 * Reads a response body, refusing to hold more than `maxBytes` in memory.
 *
 * The size check has to happen DURING the read, not after: buffering the whole
 * body and then measuring it means any sender who can attach a large file has
 * already allocated it on the worker handling their webhook. A declared
 * Content-Length over the cap is rejected without reading at all.
 */
export async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get('content-length'))

  if (Number.isFinite(declared) && declared > maxBytes) return null
  const reader = response.body?.getReader()

  if (!reader) return null
  const chunks: Uint8Array[] = []
  let total = 0

  try {
    for (;;) {
      const { done, value }: { done: boolean; value?: Uint8Array } = await reader.read()

      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()

        return null
      }
      chunks.push(value)
    }
  } catch {
    await reader.cancel().catch(() => {})

    return null
  }
  if (total === 0) return null
  const out = new Uint8Array(total)
  let offset = 0

  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }

  return out
}

export function isImageContentType(contentType?: string | null): boolean {
  return !!contentType && contentType.startsWith('image/')
}

/**
 * Puts attached bytes into the transfer store. Returns null when there is
 * nothing to ingest or the store rejects the batch (too many/too large) —
 * callers degrade to running the turn on its text alone rather than failing
 * the message, and say so in the thread.
 */
export async function ingestInboundFiles(args: {
  teamId: string
  userId: string
  sessionId: string
  files: InboundFile[]
  label?: string
}): Promise<IngestedFiles | null> {
  if (args.files.length === 0) return null
  const scope = {
    teamId: new ObjectId(args.teamId),
    userId: args.userId,
    sessionId: args.sessionId,
  }

  try {
    const created = await createTransfer(
      scope,
      'upload',
      args.files.map((file) => ({
        fileName: file.fileName,
        size: file.bytes.byteLength,
        contentType: file.contentType ?? null,
      })),
      args.label,
    )

    await Promise.all(
      created.files.map(async (item, index) => {
        const file = args.files[index]!
        const response = await fetch(item.uploadUrl, {
          method: 'PUT',
          // A stalled presigned upload would otherwise pin the worker handling
          // this webhook indefinitely.
          signal: AbortSignal.timeout(TRANSFER_PUT_TIMEOUT_MS),
          body: new Blob([file.bytes.slice().buffer as ArrayBuffer]),
          ...(file.contentType ? { headers: { 'content-type': file.contentType } } : {}),
        })

        if (!response.ok) {
          throw new Error(`upload failed for ${file.fileName}: HTTP ${String(response.status)}`)
        }
      }),
    )
    const finalized = await finalizeTransfer(scope, created.groupId)
    const ready = finalized.files.filter((file) => file.status === 'ready')

    if (ready.length === 0) return null

    return { groupId: created.groupId, fileNames: ready.map((file) => file.fileName) }
  } catch (err) {
    logEvent('warn', 'agent.inbound_files.ingest_failed', {
      team_id: args.teamId,
      session_id: args.sessionId,
      file_count: args.files.length,
      error: err instanceof Error ? err.message : String(err),
    })

    return null
  }
}

/**
 * The instruction that tells the agent where the attachment went. Deliberately
 * the same shape and wording the desktop composer emits for a `transfer-upload`
 * part, so the file-transfer skill sees one consistent story.
 */
export function renderInboundFileInstruction(ingested: IngestedFiles): string {
  const names = ingested.fileNames.join(', ')

  return (
    `[The user attached ${String(ingested.fileNames.length)} file(s) to this message; they are in the ` +
    `Nuphos file-transfer store (transfer group ${ingested.groupId}): ${names}. To work with them, ` +
    `load the file-transfer skill and pull them into the sandbox: ` +
    `bash skills/file-transfer/scripts/transfer-pull.sh "$TEAM" ${ingested.groupId} ./uploads]`
  )
}

/** Told to the user, and to the agent, when bytes could not be stored. */
export const INBOUND_FILE_FAILURE_NOTE =
  '[The user attached files to this message, but they could not be read. Ask them to share the file another way rather than guessing at its contents.]'

/**
 * A vision part for an image small enough to inline, or null. The data URL is
 * stripped before the transcript is persisted (see stripInlineFileData in
 * routes/agent.ts) so it costs nothing durable.
 */
export function renderInboundImagePart(
  file: InboundFile,
): { type: 'file'; mediaType: string; url: string } | null {
  if (!isImageContentType(file.contentType)) return null
  if (file.bytes.byteLength > MAX_INLINE_IMAGE_BYTES) return null

  return {
    type: 'file',
    mediaType: file.contentType!,
    url: `data:${String(file.contentType)};base64,${Buffer.from(file.bytes).toString('base64')}`,
  }
}

/**
 * Replaces inline `data:` payloads on file parts with a short placeholder
 * before a turn is persisted.
 *
 * A vision part carries the whole image as base64. The transcript is re-read
 * to rebuild history on EVERY later turn of the conversation and lives in one
 * Mongo document (16 MB ceiling), so storing those bytes would grow unbounded
 * for no benefit — the image is already in the transfer store, and the model
 * only needs to see it in the turn it arrived. Non-data URLs are left alone.
 */
export function stripInlineFileData(parts: unknown[]): unknown[] {
  return parts.map((part) => {
    if (!part || typeof part !== 'object') return part
    const value = part as Record<string, unknown>

    if (value.type !== 'file' || typeof value.url !== 'string') return part
    if (!value.url.startsWith('data:')) return part
    const mediaType = typeof value.mediaType === 'string' ? value.mediaType : 'file'

    return { type: 'text', text: `[${mediaType} attachment shown to the agent in this turn]` }
  })
}
