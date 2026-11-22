import clsx from 'clsx'

import { stripMarkdown } from '../../../lib/agentStopNotification'

import { jumpTo } from './jumpTo'

import type { AgentMessageReply } from '../../../api'

/**
 * The message a reply answers, at the top of the reply's own bubble: its
 * author, then two lines of it as plain text, so a link reads as its label.
 * Clicking it goes there when it is in the chat.
 */
export function ReplyQuote({ reply, mine }: { reply: AgentMessageReply; mine: boolean }) {
  const { id } = reply
  const text = stripMarkdown(reply.text)

  return (
    <button
      type="button"
      title={text}
      disabled={!id}
      onClick={() => id && jumpTo(id)}
      className={clsx(
        '-mx-1 mb-1.5 flex w-[calc(100%+0.5rem)] max-w-[18rem] min-w-0 flex-col items-start overflow-hidden rounded-lg px-2.5 py-1.5 text-left text-[12.5px] leading-[18px]',
        mine ? 'bg-white/15' : 'bg-black/5',
      )}
    >
      <span className="max-w-full truncate font-medium opacity-90">{reply.authorName}</span>
      {/* A run with no break point (a CSV header, a URL) wraps anywhere: otherwise
          its width is the line's own and it spills out of the bubble and the chat. */}
      <span className="line-clamp-2 w-full [overflow-wrap:anywhere] opacity-70">{text}</span>
    </button>
  )
}
