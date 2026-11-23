import clsx from 'clsx'
import { Mail, UserPlus } from 'lucide-react'

import { Modal } from '../../components/Modal'
import { Button } from '../../components/ui/button'
import { InputGroup, InputGroupInput } from '../../components/ui/input-group'
import { t } from '../../i18n'

import { INVITE_ROLES, roleDetail, roleLabel } from './memberRows'

import type { TeamRole } from '../../types'
import type { FormEvent } from 'react'

export function InviteMemberModal({
  open,
  submitting,
  email,
  onEmailChange,
  role,
  onRoleChange,
  onClose,
  onSubmit,
}: {
  open: boolean
  submitting: boolean
  email: string
  onEmailChange: (value: string) => void
  role: TeamRole
  onRoleChange: (role: TeamRole) => void
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
      title={t('Invite member')}
      description={t('Send a team invitation by email.')}
    >
      <form onSubmit={onSubmit} className="p-5 space-y-4">
        <label className="block">
          <span className="block text-[12px] text-tertiary mb-1.5">{t('Email')}</span>
          <InputGroup className="flex items-center gap-2 rounded-md border border-line-control bg-surface px-3 h-10 transition-colors">
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
        <fieldset className="space-y-1.5">
          <legend className="mb-1.5 block text-[12px] text-tertiary">{t('Joins as')}</legend>
          {INVITE_ROLES.map((option) => (
            <label
              key={option}
              className={clsx(
                'flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 transition-colors',
                option === role
                  ? 'border-action-primary/45 bg-state-selected'
                  : 'border-line-control hover:bg-state-hover',
              )}
            >
              <input
                type="radio"
                name="invite-role"
                value={option}
                checked={option === role}
                disabled={submitting}
                onChange={() => onRoleChange(option)}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-main">{roleLabel(option)}</span>
                <span className="block text-[12px] leading-snug text-tertiary">
                  {roleDetail(option)}
                </span>
              </span>
            </label>
          ))}
          <p className="text-[11.5px] text-tertiary">{t('You can change it after they join.')}</p>
        </fieldset>
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="h-8 px-3 rounded-md border border-line-control text-secondary hover:text-main hover:bg-state-hover text-[12.5px] transition-colors disabled:cursor-default disabled:opacity-60"
          >
            {t('Cancel')}
          </button>
          <Button size="sm" type="submit" disabled={!email.trim() || submitting}>
            <UserPlus className="w-3.5 h-3.5" strokeWidth={2} />
            {submitting ? t('Inviting…') : t('Invite')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
