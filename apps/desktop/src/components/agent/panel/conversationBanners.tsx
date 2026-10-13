import { useState } from 'react'

import { Modal } from '../../Modal'

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
