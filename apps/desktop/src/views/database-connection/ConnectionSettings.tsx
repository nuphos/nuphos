import { ShieldCheck, Trash2 } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'

import { api } from '../../api'
import { Modal } from '../../components/Modal'
import { SectionHeader } from '../../components/SectionHeader'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import { PlanApprovalPolicyModal } from './PlanApprovalPolicyModal'

import type { PlanApprovalRequirement } from '../../api'
import type { DatabaseConnection } from '../../types'

type PolicyMode = 'requester' | 'one-other' | 'quorum'

/** The team-wide approval policy MongoDB change proposals follow; admins can edit it. */
function PlanApprovalPolicySection({
  teamId,
  isTeamAdmin,
}: {
  teamId: string
  isTeamAdmin: boolean
}) {
  const [policy, setPolicy] = useState<PlanApprovalRequirement | null>(null)
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<PolicyMode>('requester')
  const [quorum, setQuorum] = useState(2)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true

    api.agentGetPlanApprovalPolicy(teamId).then(
      (next) => {
        if (alive) setPolicy(next)
      },
      () => {
        if (alive) setPolicy(null)
      },
    )

    return () => {
      alive = false
    }
  }, [teamId])

  const minimum = policy?.minimumOtherApprovals ?? 0
  const edit = () => {
    setMode(minimum === 0 ? 'requester' : minimum === 1 ? 'one-other' : 'quorum')
    setQuorum(Math.max(2, minimum))
    setOpen(true)
  }
  const save = async () => {
    setSaving(true)
    try {
      setPolicy(
        await api.agentUpdatePlanApprovalPolicy(
          teamId,
          mode === 'requester' ? 0 : mode === 'one-other' ? 1 : quorum,
        ),
      )
      setOpen(false)
      toast.success(t('Approval policy updated'))
    } catch (err) {
      toast.apiError(t('Could not update approval policy'), err, {
        fallback: t('The approval policy was not updated. Please try again.'),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-3 flex items-center gap-2">
      <span className="text-[12px] text-secondary">
        {policy
          ? minimum === 0
            ? t('Requester only')
            : t('Requester + {count} other member(s)', { count: String(minimum) })
          : t('Loading…')}
      </span>
      {isTeamAdmin && policy && (
        <Button size="sm" variant="secondary" onClick={edit}>
          {t('Edit')}
        </Button>
      )}
      <PlanApprovalPolicyModal
        open={open}
        saving={saving}
        mode={mode}
        quorum={quorum}
        onModeChange={setMode}
        onQuorumChange={setQuorum}
        onClose={() => setOpen(false)}
        onSave={() => void save()}
      />
    </div>
  )
}

export function ConnectionSettingsSection({
  teamId,
  connection,
  busy,
  isTeamAdmin,
  onRemoveOpen,
}: {
  teamId: string
  connection: DatabaseConnection
  busy: boolean
  isTeamAdmin: boolean
  onRemoveOpen: () => void
}) {
  return (
    <>
      {connection.engine === 'mongodb' && (
        <section className="px-6 py-4">
          <SectionHeader
            icon={<ShieldCheck className="h-4 w-4 text-primary" strokeWidth={1.8} />}
            title={t('Plan approval policy')}
            hint={t('Applies to the whole team')}
          />
          <div className="max-w-xl">
            <p className="text-[12px] leading-5 text-tertiary">
              {t(
                'New MongoDB DML and DDL proposals follow this team-wide policy: requester only, requester plus one teammate, or a larger quorum.',
              )}
            </p>
            <PlanApprovalPolicySection teamId={teamId} isTeamAdmin={isTeamAdmin} />
            <div className="mt-3 rounded-md border border-line-control bg-state-selected p-2.5 text-[10.5px] leading-4 text-tertiary">
              {t(
                'Approval and execution remain separate. Only the requester and any additional executors selected when the Plan was proposed may explicitly run its immutable approved statement. Existing legacy database requests retain their original policy snapshot.',
              )}
            </div>
          </div>
        </section>
      )}
      <section className="border-t border-line-control/60 px-6 py-4">
        <SectionHeader
          icon={<Trash2 className="h-4 w-4 text-error" strokeWidth={1.8} />}
          title={t('Danger zone')}
        />
        <div className="max-w-xl">
          <p className="text-[12px] text-tertiary">
            {connection.providerOrigin
              ? t(
                  'Removing from Nuphos deletes the provider binding reference and resource metadata. It does not delete or modify the database.',
                )
              : t(
                  'Removing from Nuphos deletes the encrypted credential and resource metadata. It does not delete or modify the database.',
                )}
          </p>
          {isTeamAdmin && (
            <button
              disabled={busy}
              onClick={onRemoveOpen}
              className="mt-4 flex items-center gap-1.5 rounded-md border border-error/40 px-3 py-1.5 text-[12px] text-error hover:bg-error/5 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t('Remove from Nuphos')}
            </button>
          )}
        </div>
      </section>
    </>
  )
}

export function RemoveConnectionModal({
  connection,
  open,
  busy,
  removeName,
  onRemoveNameChange,
  onClose,
  onRemove,
}: {
  connection: DatabaseConnection
  open: boolean
  busy: boolean
  removeName: string
  onRemoveNameChange: (value: string) => void
  onClose: () => void
  onRemove: () => void
}) {
  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose()
      }}
      title={t('Remove database from Nuphos')}
      description={
        connection.providerOrigin
          ? t(
              'This removes the provider binding reference and Nuphos resource metadata. It never drops or modifies the underlying database.',
            )
          : t(
              'This removes the encrypted credential and Nuphos resource metadata. It never drops or modifies the underlying database.',
            )
      }
      width={500}
      footer={
        <div className="flex justify-end gap-2 px-5 py-3">
          <button
            disabled={busy}
            onClick={onClose}
            className="px-3 py-1.5 text-[12px] text-secondary hover:text-main disabled:opacity-50"
          >
            {t('Cancel')}
          </button>
          <Button
            variant="destructive"
            size="sm"
            disabled={busy || removeName !== connection.name}
            onClick={onRemove}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('Confirm name')}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 px-5 py-4">
        <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2.5 text-[11.5px] leading-5 text-warning">
          {t(
            'Type {name} to continue. A final confirmation will appear before the backend request is sent.',
          )
            .split('{name}')
            .map((part, i) => (
              <Fragment key={i}>
                {i > 0 && <span className="font-mono font-semibold">{connection.name}</span>}
                {part}
              </Fragment>
            ))}
        </div>
        <label className="block text-[12px] text-secondary">
          {t('Database name')}
          <input
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={removeName}
            onChange={(event) => onRemoveNameChange(event.target.value)}
            placeholder={connection.name}
            className="mt-1 w-full rounded-md border border-line-control bg-surface px-2.5 py-2 font-mono text-[12.5px] text-main outline-none focus:border-error"
          />
        </label>
      </div>
    </Modal>
  )
}
