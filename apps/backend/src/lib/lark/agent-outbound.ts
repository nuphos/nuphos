import { ObjectId } from 'mongodb'

import { sendLarkMessage } from '@/lib/lark/api'
import { getLarkGroup, listJoinedLarkGroups } from '@/lib/lark/destinations'
import { getLarkBindingForTeam, larkAppContext } from '@/lib/lark/installations'
import { logEvent } from '@/lib/observability'

import type { LarkAppContext, LarkDomain } from '@/lib/lark/api'
import type { LarkGroupDestination } from '@/lib/lark/destinations'

// Team-scoped capability that lets a running agent proactively post to a Lark
// group the bot belongs to (the "lark_post" tool), independent of any @mention
// that may have started the turn. Mirrors slack/agent-outbound.ts, minus the
// monitoring-incident lifecycle — this is a plain "send to a group" send.
export type LarkOutboundContext = {
  listDestinations: () => Promise<{
    ok: true
    app: { appId: string; domain: LarkDomain }
    groups: LarkGroupDestination[]
  }>
  post: (input: {
    chatId: string
    text: string
  }) => Promise<
    | { ok: true; chatId: string; name: string; messageId: string | null }
    | { ok: false; error: string }
  >
}

// Returns null when the team has no Lark app connected — the tool layer turns
// that into a structured `lark_not_connected` blocker so an unconnected team
// sees "connect Lark", not a missing capability.
export async function createLarkOutboundContext(args: {
  teamId: string | null | undefined
}): Promise<LarkOutboundContext | null> {
  if (!args.teamId) return null
  let teamObjectId: ObjectId

  try {
    teamObjectId = new ObjectId(args.teamId)
  } catch {
    return null
  }
  const binding = await getLarkBindingForTeam(teamObjectId)

  if (!binding) return null

  // Re-resolve the binding at execution time so a mid-turn disconnect fails
  // closed rather than posting with a stale credential.
  const resolveCtx = async (): Promise<LarkAppContext | null> => {
    const fresh = await getLarkBindingForTeam(teamObjectId)

    return fresh ? larkAppContext(fresh) : null
  }

  return {
    listDestinations: async () => {
      const ctx = await resolveCtx()

      if (!ctx) throw new Error('Lark is no longer connected to this team.')
      const groups = await listJoinedLarkGroups(ctx)

      return { ok: true, app: { appId: binding.appId, domain: binding.domain }, groups }
    },
    post: async ({ chatId, text }) => {
      const ctx = await resolveCtx()

      if (!ctx) return { ok: false, error: 'Lark is no longer connected to this team.' }
      // Re-validate membership so we never post to a chat the bot was removed
      // from (or a fabricated id).
      const group = await getLarkGroup(ctx, chatId)

      if (!group) {
        return {
          ok: false,
          error: `The bot is not a member of chat ${chatId} (or it no longer exists). Call lark_list_destinations for valid group ids.`,
        }
      }
      try {
        const { messageId } = await sendLarkMessage({
          ctx,
          receiveIdType: 'chat_id',
          receiveId: chatId,
          msgType: 'text',
          content: JSON.stringify({ text }),
        })

        logEvent('info', 'lark.agent.outbound_post', {
          team_id: args.teamId ?? undefined,
          lark_app_id: binding.appId,
          lark_chat_id: chatId,
        })

        return { ok: true, chatId, name: group.name, messageId }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  }
}
