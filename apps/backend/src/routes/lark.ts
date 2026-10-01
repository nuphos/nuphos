import { Hono } from 'hono'

import { AppError } from '@/lib/errors'
import { decryptLarkEvent, verifyLarkSignature } from '@/lib/lark/api'
import { resolveLarkApp } from '@/lib/lark/installations'
import { logError } from '@/lib/observability'
import { handleBotAddedToChat, handleBotRemovedFromChat } from '@/routes/lark/chat-membership'
import { handleLarkMessage } from '@/routes/lark/handle-message'
import { registerLarkManagementRoutes } from '@/routes/lark/management'

import type { AuthVariables } from '@/middleware/auth'
import type { LarkChatMemberEvent } from '@/routes/lark/chat-membership'
import type { LarkMessageEvent } from '@/routes/lark/handle-message'

export const larkRoutes = new Hono<{ Variables: AuthVariables }>()

// ─── Event webhook (per custom app) ──────────────────────────────────────────
// Each team sets its Feishu app's Event Request URL to /lark/events/:appId — the
// app_id is in the URL because an encrypted event body hides it until decrypted,
// and the Encrypt Key needed to decrypt is stored per app. Accept-then-process:
// verify + decrypt synchronously, answer challenges, dispatch work detached.
larkRoutes.post('/events/:appId', async (c) => {
  const appId = c.req.param('appId')
  const app = await resolveLarkApp(appId)

  if (!app) throw new AppError(404, 'lark_app_not_found', 'No Lark app is registered for this URL')

  const rawBody = await c.req.text()

  let outer: Record<string, unknown>

  try {
    outer = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    throw new AppError(400, 'invalid_body', 'Lark event body is not valid JSON')
  }

  // Decrypt first: every custom app has an Encrypt Key, so a genuine payload is
  // AES-encrypted. Successfully decrypting with the app's stored Encrypt Key
  // proves the sender knows the shared secret.
  let payload: Record<string, unknown> = outer

  if (typeof outer.encrypt === 'string') {
    try {
      payload = JSON.parse(decryptLarkEvent(outer.encrypt, app.encryptKey)) as Record<
        string,
        unknown
      >
    } catch (err) {
      throw new AppError(
        400,
        'decrypt_failed',
        err instanceof Error ? err.message : 'Lark event decrypt failed',
      )
    }
  }

  // URL verification handshake (event-subscription setup). Feishu sends this
  // challenge WITHOUT an X-Lark-Signature header — even when an Encrypt Key is
  // configured — so we must NOT require a signature here (doing so was rejecting
  // every real challenge with 401). Decrypting the body above already
  // authenticated the sender via the Encrypt Key, so the challenge is trusted.
  if (payload.type === 'url_verification') {
    return c.json({ challenge: payload.challenge })
  }

  // Real events DO carry a signature (sha256(timestamp+nonce+encryptKey+body));
  // verify it before dispatching any work.
  const ok = verifyLarkSignature({
    encryptKey: app.encryptKey,
    rawBody,
    timestamp: c.req.header('X-Lark-Request-Timestamp'),
    nonce: c.req.header('X-Lark-Request-Nonce'),
    signature: c.req.header('X-Lark-Signature'),
  })

  if (!ok) throw new AppError(401, 'invalid_signature', 'Lark event signature verification failed')

  const eventType = (payload.header as { event_type?: string } | undefined)?.event_type

  if (eventType === 'im.message.receive_v1') {
    void handleLarkMessage(app, payload as LarkMessageEvent).catch((err: unknown) => {
      logError('lark.agent.handler.error', err, { lark_app_id: appId })
    })
  } else if (eventType === 'im.chat.member.bot.added_v1') {
    void handleBotAddedToChat(app, payload as LarkChatMemberEvent).catch((err: unknown) => {
      logError('lark.agent.bot_added.error', err, { lark_app_id: appId })
    })
  } else if (eventType === 'im.chat.member.bot.deleted_v1') {
    void handleBotRemovedFromChat(app, payload as LarkChatMemberEvent).catch((err: unknown) => {
      logError('lark.agent.bot_removed.error', err, { lark_app_id: appId })
    })
  }

  return c.json({ code: 0 })
})

registerLarkManagementRoutes(larkRoutes)
