import clsx from 'clsx'

import { jumpTo } from './jumpTo'

import type { AgentMessageReply } from '../../../api'

/**
 * The message a reply answers, at the top of the reply's own bubble: its
 * author, then two lines of it. Clicking it goes there when it is in the chat.
 * In a bubble it spans the bubble's full width but never widens it: `contain`
 * keeps a long quote from stretching a short reply past `min-w`. That minimum
 * reads the message row's width (`cqw`; the row is an inline-size container),
 * less the avatar, the reply button's room, gaps and bubble padding, so a
 * narrow pane shrinks the quote with its bubble instead of spilling it.
 */
export function ReplyQuote({
  reply,
  mine,
  standalone = false,
}: {
  reply: AgentMessageReply
  mine: boolean
  /** Above a reply of files alone, with no bubble to fill: it keeps a modest width. */
  standalone?: boolean
}) {
  const { id } = reply

  return (
    <button
      type="button"
      title={reply.text}
      disabled={!id}
      onClick={() => id && jumpTo(id)}
      className={clsx(
        '-mx-1 mb-1.5 flex w-[calc(100%+0.5rem)] flex-col items-start rounded-lg px-2.5 py-1.5 text-left text-[12.5px] leading-[18px]',
        standalone ? 'max-w-[18rem]' : 'min-w-[min(15rem,calc(100cqw-6rem))] [contain:inline-size]',
        mine ? 'bg-white/15' : 'bg-black/5',
      )}
    >
      <span className="max-w-full truncate font-medium opacity-90">{reply.authorName}</span>
      <span className="line-clamp-2 opacity-70">{reply.text}</span>
    </button>
  )
}
