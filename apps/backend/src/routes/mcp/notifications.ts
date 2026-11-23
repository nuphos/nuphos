import { createHash } from 'node:crypto'

import { streamSSE } from 'hono/streaming'

import { getReadableConversation } from '@/lib/agent/db'
import { fail } from '@/lib/mcp/protocol'
import { logError } from '@/lib/observability'
import { nuphosCheck } from '@/routes/mcp/check'
import { admitMcpSubscription } from '@/routes/mcp/subscription-limit'

import type { AuthVariables } from '@/middleware/auth'
import type { Context } from 'hono'

/** A resumable current-state notification, rebuilt from stored answers and Task reports. */
export async function sessionNotification(sessionId: string, userId: string) {
  const conversation = await getReadableConversation(sessionId, userId)

  if (!conversation) return null
  const checked = await nuphosCheck({ session_id: sessionId }, { userId })

  if (checked.isError) return null
  const state = checked.structuredContent as Record<string, unknown>
  const report = conversation.taskReport
  const params = {
    session_id: sessionId,
    status: state.status,
    message_count: conversation.messageCount,
    ...(state.answer !== undefined ? { answer: state.answer } : {}),
    ...(state.error ? { error: state.error } : {}),
    ...(state.requests ? { requests: state.requests } : {}),
    ...(report
      ? {
          task_report: {
            id: report.id,
            status: report.status,
            summary: report.summary,
            ...(report.data ? { data: report.data } : {}),
            at: report.at.toISOString(),
          },
        }
      : {}),
  }
  const id = createHash('sha256').update(JSON.stringify(params)).digest('hex')

  return { id, notification: { jsonrpc: '2.0', method: 'notifications/nuphos/session', params } }
}

export async function subscribeMcpSession(c: Context<{ Variables: AuthVariables }>) {
  const sessionId = c.req.query('session_id')?.trim()
  const after = c.req.header('Last-Event-ID')

  if (!sessionId)
    return c.json(fail(null, -32000, 'Use POST, or supply session_id for notifications.'), 405)
  if (sessionId.length > 200) return c.json(fail(null, -32602, 'Invalid session_id.'), 400)
  if (after && !/^[a-f0-9]{64}$/.test(after))
    return c.json(fail(null, -32602, 'Invalid Last-Event-ID.'), 400)
  const userId = c.get('userId')
  const initial = await sessionNotification(sessionId, userId)

  if (!initial) return c.json(fail(null, -32000, 'Session not found.'), 404)
  const admission = await admitMcpSubscription(userId)

  if (admission === 'limited') {
    c.header('Retry-After', '5')

    return c.json(fail(null, -32000, 'Too many active subscriptions. Retry after 5 seconds.'), 429)
  }
  if (admission === 'unavailable') {
    c.header('Retry-After', '5')

    return c.json(
      fail(null, -32000, 'Subscription coordination unavailable. Retry after 5 seconds.'),
      503,
    )
  }
  c.header('Cache-Control', 'no-cache, no-transform')
  c.header('X-Accel-Buffering', 'no')

  return streamSSE(c, async (stream) => {
    let previous = after
    let current: Awaited<ReturnType<typeof sessionNotification>> = initial
    const until = Date.now() + 55_000
    // Bound the stream even if a state read stalls, before its reservation expires.
    const deadline = setTimeout(() => {
      stream.abort()
    }, 60_000)

    stream.onAbort(() => void admission.release())

    try {
      await stream.write(': connected\nretry: 1000\n\n')
      while (!stream.aborted && Date.now() < until) {
        if (!current) {
          await stream.writeSSE({
            data: JSON.stringify({
              jsonrpc: '2.0',
              method: 'notifications/nuphos/subscription_closed',
              params: { reason: 'access_revoked' },
            }),
          })

          return
        }
        if (current.id !== previous) {
          await stream.writeSSE({
            id: current.id,
            event: 'message',
            retry: 1000,
            data: JSON.stringify(current.notification),
          })
          previous = current.id
        }
        await stream.sleep(1000)
        if (stream.aborted) return
        current = await sessionNotification(sessionId, userId)
        if (stream.aborted) return
        await stream.write(': keepalive\n\n')
      }
    } catch (error) {
      if (stream.aborted) return
      logError('mcp.notifications.failed', error, { session_id: sessionId })
      await stream.writeSSE({
        data: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/nuphos/subscription_closed',
          params: { reason: 'retry' },
        }),
      })
    } finally {
      clearTimeout(deadline)
      await admission.release()
    }
  })
}
