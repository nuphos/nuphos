import clsx from 'clsx'

import { jumpTo } from './jumpTo'

import type { AgentMessageReply } from '../../../api'

/**
 * The message a reply answers, at the top of the reply's own bubble: its
 * author, then two lines of it. Clicking it goes there when it is in the chat.
 */
export function ReplyQuote({ reply, mine }: { reply: AgentMessageReply; mine: boolean }) {
  const { id } = reply

  return (
    <button
      type="button"
      title={reply.text}
      disabled={!id}
      onClick={() => id && jumpTo(id)}
      className={clsx(
        '-mx-1 mb-1.5 flex w-[calc(100%+0.5rem)] max-w-[18rem] flex-col items-start rounded-lg px-2.5 py-1.5 text-left text-[12.5px] leading-[18px]',
        mine ? 'bg-white/15' : 'bg-black/5',
      )}
    >
      <span className="max-w-full truncate font-medium opacity-90">{reply.authorName}</span>
      <span className="line-clamp-2 opacity-70">{reply.text}</span>
    </button>
  )
}
