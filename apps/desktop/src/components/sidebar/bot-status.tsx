import { ChatIcon } from '../channels/channelParts'

import { activityOf } from './bot-activity'
import { BotStatusLine } from './bot-status-line'
import { chatSidebarItem } from './chat-item'
import { ChatRowStatus } from './ChatRowStatus'

import type { Run } from './bot-activity'
import type { Item } from './types'
import type { ChannelFace } from '../../api/agent-types'

/** Reading clears the neutral dot; pending questions stay in the preview. */
function rowDot(unread: boolean): 'unread' | null {
  return unread ? 'unread' : null
}

/**
 * The rows for one Bot's chat. While the Bot or any of its sub-agents works,
 * its face plays its idle loop, the name shimmers and the preview line shows
 * the typing dots with the working run's latest message. Under the chat come
 * its actual sub-agents, without repeating the Bot's own execution as a row.
 */
export function botChatRows({
  chat,
  faces,
  bot,
  kids,
  teamId,
  unread,
  openId,
  unreadIds = new Set<string>(),
}: {
  chat: Item
  faces: ChannelFace[] | undefined
  bot: Run | undefined
  kids: Run[]
  teamId: string
  unread: boolean
  /** The chat open in the pane, if any. */
  openId: string | undefined
  unreadIds?: ReadonlySet<string>
}): Item[] {
  const copy = (run: Run, parentKey: string): Item => ({
    ...chatSidebarItem({
      conversation: run.conversation,
      teamId,
      active: openId === run.conversation.sessionId,
      runtimeState: run.runtimeState,
      unread: unreadIds.has(run.conversation.sessionId),
    }),
    parentKey,
    bot: false,
    botNested: true,
    task: true,
    preview: undefined,
    time: undefined,
  })
  const nested = kids.map((kid) => copy(kid, chat.key))
  // A sub-agent at work is the Bot at work.
  const activity = activityOf(bot, kids)
  const busy = activity.kind === 'working' || activity.kind === 'background'
  const row: Item = {
    ...chat,
    dot: rowDot(unread),
    // The motion says "working"; the mark keeps only what asks for attention.
    trailing: (
      <ChatRowStatus
        runtimeState={activity.kind === 'error' ? bot?.runtimeState : undefined}
        dot={rowDot(unread)}
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
