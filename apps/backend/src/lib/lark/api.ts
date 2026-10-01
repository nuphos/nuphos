import { readBoundedBody } from '@/lib/agent/inbound-files'
import { logEvent } from '@/lib/observability'

import { getTenantAccessToken, larkApi, larkApiHost } from './api-core'

import type { LarkApiResponse, LarkAppContext } from './api-core'

export {
  decryptLarkEvent,
  getTenantAccessToken,
  larkApi,
  larkApiHost,
  verifyLarkCredentials,
  verifyLarkSignature,
} from './api-core'
export type { LarkApiResponse, LarkAppContext, LarkDomain } from './api-core'

// ─── Messaging ───────────────────────────────────────────────────────────────
export type LarkMsgType = 'text' | 'interactive' | 'image' | 'file'

// ─── Attachments ─────────────────────────────────────────────────────────────
// Inbound and outbound both go through the tenant token. Unlike the JSON APIs
// above these are multipart / raw-bytes endpoints, so they bypass larkApi().
//
// Inbound needs `im:resource` (读取消息中的资源文件) on the customer's own
// custom app; outbound needs `im:message:send_as_bot`, which every bound app
// already has. A missing inbound permission surfaces as a non-zero code, which
// the caller degrades into "I couldn't read your attachment".

// Lark ids and keys are opaque tokens (`om_…`, `file_v3_…`, `img_v2_…`).
// Anything outside this alphabet cannot be one, and could be a path.
export function isSafePathSegment(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value)
}

/** Downloads a file/image carried by a received message. */
export async function downloadLarkMessageResource(args: {
  ctx: LarkAppContext
  messageId: string
  fileKey: string
  /** Lark keys images and files under separate resource types. */
  type: 'image' | 'file'
  maxBytes: number
}): Promise<{ bytes: Uint8Array; contentType: string | null } | null> {
  const token = await getTenantAccessToken(args.ctx)

  // Both come straight from the event payload, and the tenant token is already
  // attached, so a value that rewrites the path reaches an arbitrary open-apis
  // endpoint as us. Encoding alone does NOT stop that: encodeURIComponent('..')
  // is '..', and new URL() then normalizes the dot segment away. Only accepting
  // the shape Lark actually issues does.
  if (!isSafePathSegment(args.messageId) || !isSafePathSegment(args.fileKey)) return null
  const url = new URL(
    `${larkApiHost(args.ctx.domain)}/open-apis/im/v1/messages/${args.messageId}/resources/${args.fileKey}`,
  )

  url.searchParams.set('type', args.type)
  const response = await fetch(url.toString(), {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(60_000),
  })
  const contentType = response.headers.get('content-type')

  // Errors come back as a JSON envelope rather than a status code.
  if (!response.ok || contentType?.includes('application/json')) return null
  const bytes = await readBoundedBody(response, args.maxBytes)

  if (!bytes) return null

  return { bytes, contentType: contentType?.split(';')[0]?.trim() ?? null }
}

async function postLarkMultipart(args: {
  ctx: LarkAppContext
  path: string
  form: FormData
  dataKey: 'image_key' | 'file_key'
}): Promise<string | null> {
  const token = await getTenantAccessToken(args.ctx)
  const response = await fetch(`${larkApiHost(args.ctx.domain)}${args.path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: args.form,
    signal: AbortSignal.timeout(120_000),
  })
  const json = (await response.json().catch(() => null)) as LarkApiResponse | null

  if (!json || json.code !== 0) return null

  return (json.data?.[args.dataKey] as string | undefined) ?? null
}

/** Uploads an image and returns its image_key, or null on any failure. */
export async function uploadLarkImage(args: {
  ctx: LarkAppContext
  bytes: Uint8Array
  contentType?: string | null
}): Promise<string | null> {
  const form = new FormData()

  form.set('image_type', 'message')
  form.set(
    'image',
    new Blob([args.bytes.slice().buffer as ArrayBuffer], {
      ...(args.contentType ? { type: args.contentType } : {}),
    }),
    'image',
  )

  return await postLarkMultipart({
    ctx: args.ctx,
    path: '/open-apis/im/v1/images',
    form,
    dataKey: 'image_key',
  })
}

/** Uploads a non-image file and returns its file_key, or null on any failure. */
export async function uploadLarkFile(args: {
  ctx: LarkAppContext
  fileName: string
  bytes: Uint8Array
  contentType?: string | null
}): Promise<string | null> {
  const form = new FormData()

  // `stream` is the catch-all type; the specific ones (opus/mp4/pdf/…) only
  // change how Lark previews the file, never whether the upload is accepted.
  form.set('file_type', 'stream')
  form.set('file_name', args.fileName)
  form.set(
    'file',
    new Blob([args.bytes.slice().buffer as ArrayBuffer], {
      ...(args.contentType ? { type: args.contentType } : {}),
    }),
    args.fileName,
  )

  return await postLarkMultipart({
    ctx: args.ctx,
    path: '/open-apis/im/v1/files',
    form,
    dataKey: 'file_key',
  })
}

// Reply to a message. replyInThread groups follow-ups into a Lark topic thread
// (used for group @mentions); omit for 1:1 DMs which reply inline.
export async function replyLarkMessage(args: {
  ctx: LarkAppContext
  messageId: string
  msgType: LarkMsgType
  content: string
  replyInThread?: boolean
}): Promise<{ messageId: string | null }> {
  const json = await larkApi({
    ctx: args.ctx,
    method: 'POST',
    path: `/open-apis/im/v1/messages/${args.messageId}/reply`,
    body: {
      content: args.content,
      msg_type: args.msgType,
      ...(args.replyInThread ? { reply_in_thread: true } : {}),
    },
  })

  return { messageId: (json.data?.message_id as string | undefined) ?? null }
}

export async function sendLarkMessage(args: {
  ctx: LarkAppContext
  receiveIdType: 'chat_id' | 'open_id' | 'user_id'
  receiveId: string
  msgType: LarkMsgType
  content: string
}): Promise<{ messageId: string | null }> {
  const json = await larkApi({
    ctx: args.ctx,
    method: 'POST',
    path: '/open-apis/im/v1/messages',
    query: { receive_id_type: args.receiveIdType },
    body: { receive_id: args.receiveId, msg_type: args.msgType, content: args.content },
  })

  return { messageId: (json.data?.message_id as string | undefined) ?? null }
}

// Patch an already-sent interactive card in place (the streaming update path).
export async function patchLarkCard(args: {
  ctx: LarkAppContext
  messageId: string
  content: string
}): Promise<void> {
  await larkApi({
    ctx: args.ctx,
    method: 'PATCH',
    path: `/open-apis/im/v1/messages/${args.messageId}`,
    body: { content: args.content },
  })
}

// Best-effort lookup of a Lark user's email + display name (contact:read scope);
// returns nulls on any failure so the turn degrades gracefully.
export async function fetchLarkUser(args: {
  ctx: LarkAppContext
  openId: string
}): Promise<{ email: string | null; name: string | null }> {
  try {
    const json = await larkApi({
      ctx: args.ctx,
      method: 'GET',
      path: `/open-apis/contact/v3/users/${args.openId}`,
      query: { user_id_type: 'open_id' },
    })
    const user = json.data?.user as
      { email?: unknown; enterprise_email?: unknown; name?: unknown } | undefined
    const email = user?.email ?? user?.enterprise_email

    logEvent('info', 'lark.contact.user_fetched', {
      lark_open_id: args.openId,
      has_user: !!user,
      has_email: typeof email === 'string' && !!email.trim(),
    })

    return {
      email: typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null,
      name: typeof user?.name === 'string' ? user.name : null,
    }
  } catch (err) {
    // Surface WHY email is missing — a scope the app never published surfaces
    // here as a Lark permission error (code 99991xxx), distinct from a user who
    // simply has no email on file (which comes through the success branch above
    // with has_email:false).
    logEvent('info', 'lark.contact.user_fetch_failed', {
      lark_open_id: args.openId,
      error: err instanceof Error ? err.message : String(err),
    })

    return { email: null, name: null }
  }
}
