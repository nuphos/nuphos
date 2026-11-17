import { CornerUpLeft } from 'lucide-react'

import { jumpTo } from './jumpTo'

import type { AgentMessageReply } from '../../../api'

/** The message a reply answers, one muted line just above the reply: clicking it goes there. */
export function ReplyQuote({ reply }: { reply: AgentMessageReply }) {
  const { id } = reply

  return (
    <button
      type="button"
      title={reply.text}
      disabled={!id}
      onClick={() => id && jumpTo(id)}
      className="flex max-w-[min(100%,20rem)] items-center gap-1 px-1 text-[11px] leading-4 text-tertiary enabled:hover:text-secondary"
    >
      <CornerUpLeft size={11} className="shrink-0" aria-hidden />
      <span className="shrink-0 font-medium">{reply.authorName}</span>
      <span className="truncate">{reply.text}</span>
    </button>
  )
}
