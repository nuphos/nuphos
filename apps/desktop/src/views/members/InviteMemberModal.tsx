import clsx from 'clsx'
import { Mail, UserPlus } from 'lucide-react'

import { Modal } from '../../components/Modal'
import { InputGroup, InputGroupInput } from '../../components/ui/input-group'

import type { FormEvent } from 'react'

export function InviteMemberModal({
  open,
  submitting,
  email,
  onEmailChange,
  onClose,
  onSubmit,
}: {
  open: boolean
  submitting: boolean
  email: string
  onEmailChange: (value: string) => void
  onClose: () => void
  onSubmit: (e: FormEvent) => void
}) {
  return (
    <Modal
      open={open}
      onClose={() => {
        // A dismissal mid-flight would let the pending completion close (and
        // clear) a modal the user has since reopened.
        if (!submitting) onClose()
      }}
      title="Invite member"
      description="Send a workspace invitation by email."
    >
      <form onSubmit={onSubmit} className="p-5 space-y-4">
        <label className="block">
          <span className="block text-[12px] text-tertiary mb-1.5">Email</span>
          <InputGroup className="flex items-center gap-2 rounded-md border border-zGray-800 bg-field px-3 h-10 transition-colors">
            <Mail className="w-4 h-4 text-tertiary" strokeWidth={1.8} />
            <InputGroupInput
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => onEmailChange(e.target.value)}
              placeholder="teammate@example.com"
              className="text-[13px] text-main placeholder:text-tertiary"
            />
          </InputGroup>
        </label>
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="h-8 px-3 rounded-md border border-zGray-800 text-secondary hover:text-main hover:bg-zGray-800/70 text-[12.5px] transition-colors disabled:cursor-default disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!email.trim() || submitting}
            className={clsx(
              'h-8 px-3 rounded-md text-white text-[12.5px] font-medium flex items-center gap-1.5 transition-colors',
              email.trim() && !submitting
                ? 'bg-zViolet-500 hover:bg-zViolet-400'
                : 'bg-zGray-700 text-tertiary cursor-default',
            )}
          >
            <UserPlus className="w-3.5 h-3.5" strokeWidth={2} />
            {submitting ? 'Inviting...' : 'Invite'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
