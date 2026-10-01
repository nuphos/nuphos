import { decryptNotionSecret } from '@/lib/byos/secrets'

import type { NotionIntegrationBinding } from '@/models'

// Notion REST API. Auth is a static `Authorization: Bearer <token>` — the token
// is either an OAuth access token or an internal-integration token (ntn_… /
// legacy secret_…); both behave identically at the API. Every request must
// carry the Notion-Version header. Confirmed via developers.notion.com and the
// official notion-mcp-server.
const BASE_URL = 'https://api.notion.com/v1'

// Pinned API version, handed to the agent via /credentials so its calls match
// the version we validated the token against.
export const NOTION_VERSION = '2026-03-11'
const FETCH_TIMEOUT_MS = 30_000

export class NotionApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'NotionApiError'
  }
}

export function tokenFromBinding(binding: NotionIntegrationBinding): string {
  return decryptNotionSecret(binding.encryptedToken)
}

async function notionGet(token: string, path: string): Promise<unknown> {
  let res: Response

  try {
    res = await fetch(`${BASE_URL}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch (e) {
    const name = (e as { name?: string }).name

    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new NotionApiError(504, `Notion request timed out after ${String(FETCH_TIMEOUT_MS)}ms`)
    }
    const message = e instanceof Error ? e.message : 'unknown transport error'

    throw new NotionApiError(502, `Notion request failed: ${message}`)
  }
  if (!res.ok) {
    let detail = `HTTP ${String(res.status)}`

    try {
      const body = (await res.json()) as { message?: string; code?: string }

      detail = body.message || body.code || detail
    } catch {
      // non-JSON error body; keep the status-only detail
    }
    throw new NotionApiError(res.status, `Notion API error: ${detail}`)
  }

  return res.json()
}

export type NotionBotInfo = {
  botId: string | null
  workspaceName: string | null
}

// Identifies the integration (the bot) behind a token, and the workspace it is
// installed in. Used on bind to (a) validate the token with a cheap read and
// (b) label the binding. GET /users/me on a bot token returns
// { id, bot: { workspace_name, ... } }.
export async function verifyNotionToken(token: string): Promise<NotionBotInfo> {
  const me = (await notionGet(token, '/users/me')) as {
    id?: unknown
    bot?: { workspace_name?: unknown } | null
  }
  const botId = typeof me.id === 'string' ? me.id : null
  const workspaceName =
    me.bot && typeof me.bot.workspace_name === 'string' && me.bot.workspace_name.length > 0
      ? me.bot.workspace_name
      : null

  return { botId, workspaceName }
}
