import { apiUrl } from '../api-endpoint.ts'

import { readToken } from './http.ts'

/** What the backend did with the abort, or why we could not find out. */
export type AbortChatResult = {
  /** `local`/`forwarded` come from the backend; the rest are ours. */
  status: 'local' | 'forwarded' | 'not_found' | 'unauthenticated' | 'failed'
  detail?: string
}

/**
 * Ask the server to stop a turn.
 *
 * The server half used to be fire-and-forget inside an empty catch, so the
 * three outcomes the backend actually reports — it aborted the run itself
 * (`local`), it forwarded a cancellation to the replica that owns the run
 * (`forwarded`), or it found no such run (404) — were all invisible. Keep the
 * local SSE attached after the request: OpenAB owns the terminal state, and
 * its eventual terminal frame is what closes the renderer turn. Aborting the
 * reader here used to manufacture a local "stopped" state while the runtime
 * could still hold the session busy.
 */
export async function abortChat(streamId: string): Promise<AbortChatResult> {
  const token = await readToken()

  if (!token) return { status: 'unauthenticated' }
  try {
    const res = await fetch(`${apiUrl()}/agent/chat/${encodeURIComponent(streamId)}/abort`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })

    if (res.status === 404) return { status: 'not_found' }
    if (!res.ok) return { status: 'failed', detail: `HTTP ${String(res.status)}` }
    const body = (await res.json().catch(() => null)) as { status?: unknown } | null
    const reported = body?.status

    return reported === 'local' || reported === 'forwarded'
      ? { status: reported }
      : { status: 'failed', detail: 'unrecognized abort response' }
  } catch (err) {
    return { status: 'failed', detail: err instanceof Error ? err.message : String(err) }
  }
}
