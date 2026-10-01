import { larkApi } from '@/lib/lark/api'

import type { LarkAppContext } from '@/lib/lark/api'

// A group chat the bot belongs to — the only kind of destination lark_post can
// target. Mirrors Slack's "joined channels" model: the agent lists the groups
// the bot is actually in, then posts by chat_id (never by name).
export type LarkGroupDestination = {
  chatId: string
  name: string
  description?: string
}

// Lists every group the app's bot is a member of (im/v1/chats returns exactly
// the chats the token's bot belongs to), following pagination. Bounded so a
// pathological account can't spin forever.
export async function listJoinedLarkGroups(ctx: LarkAppContext): Promise<LarkGroupDestination[]> {
  const groups: LarkGroupDestination[] = []
  let pageToken: string | undefined

  for (let page = 0; page < 20; page++) {
    const json = await larkApi({
      ctx,
      method: 'GET',
      path: '/open-apis/im/v1/chats',
      query: { page_size: 100, ...(pageToken ? { page_token: pageToken } : {}) },
    })
    const data = json.data as
      | {
          items?: { chat_id?: string; name?: string; description?: string }[]
          page_token?: string
          has_more?: boolean
        }
      | undefined

    for (const item of data?.items ?? []) {
      if (!item.chat_id) continue
      groups.push({
        chatId: item.chat_id,
        name: item.name?.trim() || item.chat_id,
        ...(item.description?.trim() ? { description: item.description.trim() } : {}),
      })
    }
    if (!data?.has_more || !data.page_token) break
    pageToken = data.page_token
  }

  return groups
}

// Re-validates a chat_id at post time (the bot must still be a member). Returns
// null if the chat is gone or the bot was removed, so lark_post can fail closed.
export async function getLarkGroup(
  ctx: LarkAppContext,
  chatId: string,
): Promise<LarkGroupDestination | null> {
  try {
    const json = await larkApi({ ctx, method: 'GET', path: `/open-apis/im/v1/chats/${chatId}` })
    const data = json.data as { name?: unknown; description?: unknown } | undefined

    if (!data) return null

    return {
      chatId,
      name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : chatId,
      ...(typeof data.description === 'string' && data.description.trim()
        ? { description: data.description.trim() }
        : {}),
    }
  } catch {
    return null
  }
}
