import clsx from 'clsx'

import { Modal } from '../../components/Modal'
import { Button } from '../../components/ui/button'

type PolicyMode = 'requester' | 'one-other' | 'quorum'

type Props = {
  open: boolean
  saving: boolean
  mode: PolicyMode
  quorum: number
  onModeChange: (mode: PolicyMode) => void
  onQuorumChange: (quorum: number) => void
  onClose: () => void
  onSave: () => void
}

export function PlanApprovalPolicyModal({
  open,
  saving,
  mode,
  quorum,
  onModeChange,
  onQuorumChange,
  onClose,
  onSave,
}: Props) {
  return (
    <Modal
      open={open}
      onClose={() => !saving && onClose()}
      title="Plan approval policy"
      description="Choose who must approve execution Plans for this team, including Agent- and human-proposed database changes."
      width={520}
      footer={
        <div className="flex justify-end gap-2 px-5 py-3">
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={saving} onClick={onSave}>
            {saving ? 'Saving…' : 'Save policy'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 p-5">
        {(
          [
            ['requester', 'Requester only', 'The session user approves their own Agent plan.'],
            [
              'one-other',
              'Requester + one teammate',
              'Adds an independent review by another team member.',
            ],
            [
              'quorum',
              'Requester + multiple teammates',
              'Require a configurable number of other team members.',
            ],
          ] as const
        ).map(([value, title, description]) => (
          <label
            key={value}
            className={clsx(
              'flex items-start gap-3 rounded-lg border px-3.5 py-3 transition-colors',
              mode === value
                ? 'border-zViolet-accent/60 bg-zViolet-500/10'
                : 'border-zGray-800 hover:border-zGray-700',
            )}
          >
            <input
              type="radio"
              name="plan-approval-policy"
              checked={mode === value}
              onChange={() => onModeChange(value)}
              className="mt-0.5"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium text-main">{title}</span>
              <span className="mt-0.5 block text-[12px] text-tertiary">{description}</span>
            </span>
            {value === 'quorum' && mode === 'quorum' && (
              <input
                type="number"
                min={2}
                max={20}
                value={quorum}
                onChange={(event) =>
                  onQuorumChange(Math.max(2, Math.min(20, Number(event.target.value) || 2)))
                }
                onClick={(event) => event.stopPropagation()}
                className="w-16 rounded-md border border-zGray-700 bg-field px-2 py-1 text-[12px] text-main outline-none focus:border-zViolet-accent/60"
                aria-label="Required other team approvals"
              />
            )}
          </label>
        ))}
        <p className="text-[11.5px] leading-relaxed text-tertiary">
          Agent cannot approve. Changing this policy clears votes on proposed plans; approved,
          executing, and completed plans are unchanged.
        </p>
      </div>
    </Modal>
  )
}
