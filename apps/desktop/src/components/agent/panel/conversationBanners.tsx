import clsx from 'clsx'
import { ExternalLink, Loader2, MessageSquare } from 'lucide-react'
import { useCallback, useState } from 'react'

import { api } from '../../../api'
import { Modal } from '../../Modal'
import { toast } from '../../ui/toast'

import { slackThreadFallbackUrl } from './slackThreadUrl'

import type { AgentSlackThread } from '../../../api'

// Optional detail prompt after a thumbs-down. The vote itself was recorded on
// click — skipping here loses nothing.
export function FeedbackCommentDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void
  onSubmit: (comment: string) => void
}) {
  const [comment, setComment] = useState('')
  const submit = () => {
    const trimmed = comment.trim()

    if (!trimmed) return onClose()
    onSubmit(trimmed)
  }

  return (
    <Modal open onClose={onClose} title="Help us improve" width={440}>
      <div className="px-5 py-4 space-y-2 text-[13px]">
        <div className="text-secondary">
          Thanks for the feedback — mind sharing what went wrong with this response?
        </div>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          autoFocus
          rows={4}
          placeholder="What was inaccurate, unhelpful, or unexpected? (optional)"
          className="w-full px-2.5 py-1.5 rounded-md bg-field border border-zGray-800 text-main outline-none focus:border-zViolet-accent resize-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              submit()
            }
          }}
        />
      </div>
      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-zGray-800">
        <button
          onClick={onClose}
          className="px-3 py-1.5 rounded-md text-secondary hover:text-main text-[12.5px]"
        >
          Skip
        </button>
        <button
          onClick={submit}
          className="px-3 py-1.5 rounded-md bg-zViolet-500 hover:bg-zViolet-400 text-white text-[12.5px]"
        >
          Send feedback
        </button>
      </div>
    </Modal>
  )
}

export function SlackThreadBanner({ thread }: { thread: AgentSlackThread }) {
  const [opening, setOpening] = useState(false)
  const threadUrl = thread.url ?? slackThreadFallbackUrl(thread)
  const canOpen = !opening

  const openThread = useCallback(() => {
    if (opening) return
    setOpening(true)
    api
      .appOpenExternal(threadUrl)
      .catch((err: unknown) => {
        toast.apiError('Failed to open Slack thread', err)
      })
      .finally(() => {
        setOpening(false)
      })
  }, [opening, threadUrl])

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-zGray-800 bg-zGray-900/80 px-3 py-2 text-[12.5px] text-secondary">
      <div className="min-w-0 flex items-center gap-2">
        <MessageSquare className="h-3.5 w-3.5 shrink-0 text-zViolet-accent" strokeWidth={1.8} />
        <span className="truncate">Linked to Slack thread</span>
      </div>
      <button
        type="button"
        onClick={openThread}
        disabled={!canOpen}
        className={clsx(
          'h-7 w-7 shrink-0 rounded-md flex items-center justify-center transition-colors',
          canOpen
            ? 'text-secondary hover:text-main hover:bg-zGray-800'
            : 'text-tertiary cursor-not-allowed opacity-60',
        )}
        title="Open Slack thread"
        aria-label="Open Slack thread"
      >
        {opening ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
        ) : (
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.8} />
        )}
      </button>
    </div>
  )
}
