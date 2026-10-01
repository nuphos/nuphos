import {
  claimLarkEvent,
  deleteLarkChatMapping,
  markLarkEvent,
  upsertLarkChatMapping,
} from '@/lib/lark/agent-bot'
import { getLarkGroup } from '@/lib/lark/destinations'
import { logEvent } from '@/lib/observability'

import type { ResolvedLarkApp } from '@/lib/lark/installations'

// ─── Bot membership events → auto-manage the linked-chat list ─────────────────
export type LarkChatMemberEvent = {
  header?: { event_id?: string }
  event?: { chat_id?: string }
}

export async function handleBotAddedToChat(
  app: ResolvedLarkApp,
  body: LarkChatMemberEvent,
): Promise<void> {
  const { ctx, binding } = app
  const appId = binding.appId
  const teamId = app.nuphosTeamId
  const eventId = body.header?.event_id
  const chatId = body.event?.chat_id

  if (!eventId || !chatId) return
  if (!(await claimLarkEvent({ eventId, appId, chatId }))) return
  try {
    // Adding the bot to a group is an explicit action by a team member, so the
    // group is linked automatically — the admin never has to paste a chat id.
    const info = await getLarkGroup(ctx, chatId).catch(() => null)

    await upsertLarkChatMapping({
      appId,
      chatId,
      teamId,
      createdBy: 'auto:lark-bot-added',
      ...(info?.name ? { name: info.name } : {}),
    })
    logEvent('info', 'lark.agent.chat_mapping.auto_link', {
      team_id: teamId,
      lark_app_id: appId,
      lark_chat_id: chatId,
      source: 'bot_added',
    })
    await markLarkEvent(eventId, 'completed')
  } catch (err) {
    await markLarkEvent(eventId, 'failed', err instanceof Error ? err.message : String(err))
    throw err
  }
}

export async function handleBotRemovedFromChat(
  app: ResolvedLarkApp,
  body: LarkChatMemberEvent,
): Promise<void> {
  const appId = app.binding.appId
  const teamId = app.nuphosTeamId
  const eventId = body.header?.event_id
  const chatId = body.event?.chat_id

  if (!eventId || !chatId) return
  if (!(await claimLarkEvent({ eventId, appId, chatId }))) return
  try {
    await deleteLarkChatMapping(appId, chatId, teamId)
    logEvent('info', 'lark.agent.chat_mapping.removed', {
      team_id: teamId,
      lark_app_id: appId,
      lark_chat_id: chatId,
    })
    await markLarkEvent(eventId, 'completed')
  } catch (err) {
    await markLarkEvent(eventId, 'failed', err instanceof Error ? err.message : String(err))
    throw err
  }
}
