import { chatTyping } from '../../lib/runtimeExecution'
import { ChatIcon } from '../channels/channelParts'

import { activityOf } from './bot-activity'
import { BotStatusLine, TypingPreview } from './bot-status-line'
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
 * its face plays its idle loop. The preview line is the chat's newest post, or the
 * typing dots exactly while the chat shows them (a sub-agent's work never does).
 * Under the chat come its actual sub-agents, without repeating the Bot's own
 * execution as a row. They carry no unread: the Bot's one dot is its own messages,
 * and no status of theirs shows on the Bot when it is folded.
 */
export function botChatRows({
  chat,
  faces,
  bot,
  kids,
  teamId,
  unread,
  openId,
}: {
  chat: Item
  faces: ChannelFace[] | undefined
  bot: Run | undefined
  kids: Run[]
  teamId: string
  unread: boolean
  /** The chat open in the pane, if any. */
  openId: string | undefined
}): Item[] {
  const copy = (run: Run, parentKey: string): Item => ({
    ...chatSidebarItem({
      conversation: run.conversation,
      teamId,
      active: openId === run.conversation.sessionId,
      runtimeState: run.runtimeState,
      unread: false,
    }),
    parentKey,
    bot: false,
    botNested: true,
    task: true,
    preview: undefined,
    time: undefined,
    foldedStatus: undefined,
  })
  const nested = kids.map((kid) => copy(kid, chat.key))
  // A sub-agent at work is the Bot at work.
  const activity = activityOf(bot, kids)
  const busy = activity.kind === 'working' || activity.kind === 'background'
  const typing =
    Boolean(chat.channel) &&
    chatTyping(bot?.runtimeState, chat.key.replace('agent-session:', ''), true)
  // A question is the Inbox's to show: the preview stays the chat's newest post.
  const status =
    activity.kind === 'onboarding' || activity.kind === 'error' ? (
      <BotStatusLine activity={activity} />
    ) : undefined
  const previewNode = status ?? (typing ? <TypingPreview /> : undefined)
  // A Bot with no chat yet is listed by its own session, which has no chat faces: its own face.
  const face: ChannelFace[] | undefined =
    faces ??
    (bot?.conversation.avatar
      ? [
          {
            id: bot.conversation.sessionId,
            name: bot.conversation.title,
            agent: {
              avatar: bot.conversation.avatar,
              avatarBackground: bot.conversation.avatarBackground,
              provider: bot.conversation.agentRuntime,
            },
          },
        ]
      : undefined)
  const row: Item = {
    ...chat,
    // Only the face says the Bot works: not the spinner its own session shows when folded.
    foldedStatus: undefined,
    dot: rowDot(unread),
    // The motion says "working"; the mark keeps only what asks for attention.
    trailing: (
      <ChatRowStatus
        runtimeState={activity.kind === 'error' ? bot?.runtimeState : undefined}
        dot={rowDot(unread)}
      />
    ),
    // Bots draws a Bot with no chat by its face, so the loop takes that place too.
    ...(busy && {
      iconNode: <ChatIcon faces={face} title={chat.label} sidebar looping />,
      ...(chat.face && { face: <ChatIcon faces={face} title={chat.label} sidebar looping /> }),
    }),
    ...(previewNode && { previewNode }),
  }

  return [row, ...nested]
}
