import { setOpenedFromBots } from '../../lib/botNestedSelection'
import { ChatIcon } from '../channels/channelParts'

import { activityOf } from './bot-activity'
import { BotStatusLine } from './bot-status-line'
import { chatSidebarItem } from './chat-item'
import { ChatRowStatus } from './ChatRowStatus'

import type { Activity, Run } from './bot-activity'
import type { Item } from './types'
import type { ChannelFace } from '../../api/agent-types'

/** A question outranks an unread reply; work alone shows no dot. */
function rowDot(activity: Activity, unread: boolean): 'waiting' | 'unread' | null {
  if (activity.kind === 'asking') return 'waiting'

  return unread ? 'unread' : null
}

/**
 * The rows for one Bot's chat. While the Bot or any of its sub-agents works,
 * its face plays its idle loop, the name shimmers and the preview line shows
 * the typing dots with the working run's latest message. Under the chat come
 * the Bot's own Task and that Task's sub-agents, nested as Tasks lists them.
 */
export function botChatRows({
  chat,
  faces,
  bot,
  kids,
  teamId,
  unread,
  openId,
  fromBots,
}: {
  chat: Item
  faces: ChannelFace[] | undefined
  bot: Run | undefined
  kids: Run[]
  teamId: string
  unread: boolean
  /** The chat open in the pane, if any. */
  openId: string | undefined
  /** Tasks last opened from under their Bot rather than from Tasks. */
  fromBots: ReadonlySet<string>
}): Item[] {
  const copy = (run: Run, parentKey: string): Item => ({
    ...chatSidebarItem({
      conversation: run.conversation,
      teamId,
      active: openId === run.conversation.sessionId && fromBots.has(run.conversation.sessionId),
      runtimeState: run.runtimeState,
      unread: false,
    }),
    parentKey,
    bot: false,
    botNested: true,
    task: true,
    preview: undefined,
    time: undefined,
    onPress: () => setOpenedFromBots(run.conversation.sessionId, true),
  })
  const botKey = bot ? `agent-session:${bot.conversation.sessionId}` : chat.key
  // The Bot's own Task stays in view: it is the Bot, not a finished sub-agent to fold away.
  const own = bot ? [{ ...copy(bot, chat.key), finished: false }] : []
  const nested = [...own, ...kids.map((kid) => copy(kid, botKey))]
  // A sub-agent at work is the Bot at work.
  const activity = activityOf(bot, kids)
  const busy = activity.kind === 'working' || activity.kind === 'background'
  const row: Item = {
    ...chat,
    // The motion says "working"; the mark keeps only what asks for attention.
    trailing: (
      <ChatRowStatus
        runtimeState={activity.kind === 'error' ? bot?.runtimeState : undefined}
        dot={rowDot(activity, unread)}
      />
    ),
    ...(busy && {
      iconNode: <ChatIcon faces={faces} title={chat.label} sidebar looping />,
      labelShimmer: true,
    }),
    ...(activity.kind !== 'idle' && { previewNode: <BotStatusLine activity={activity} /> }),
  }

  return [row, ...nested]
}
