import { Clock, Loader2, Play, Trash2, Webhook } from 'lucide-react'

import { Button } from '../../components/ui/button'
import { t } from '../../i18n'

import { Field, TypePill } from './parts'

import type { GroupOverviewForm } from './groupOverviewLogic'
import type { AgentTriggerGroup } from '../../api'

export function GroupFormFields({
  group,
  form,
  canManage,
  setForm,
}: {
  group: AgentTriggerGroup
  form: GroupOverviewForm
  canManage: boolean
  setForm: React.Dispatch<React.SetStateAction<GroupOverviewForm>>
}) {
  return (
    <>
      <Field label={t('Name')} htmlFor="trigger-group-name">
        <input
          id="trigger-group-name"
          type="text"
          value={form.name}
          disabled={!canManage}
          onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          maxLength={100}
          className="h-8 w-full rounded-md border border-zGray-800 bg-surface px-2.5 text-[13px] text-main focus:border-zViolet-500 focus:outline-none"
        />
      </Field>

      <Field label={t('Type')}>
        <div className="flex gap-2" role="group" aria-label={t('Trigger type')}>
          <TypePill icon={Clock} label="Cron" active={false} disabled onClick={() => {}} />
          <TypePill icon={Webhook} label="Webhook" active disabled onClick={() => {}} />
        </div>
        <p className="mt-1.5 text-[11.5px] text-tertiary">
          {t('This Group uses {ingresses} for {items}.', {
            ingresses:
              group.partitionCount === 1
                ? t('{n} shared webhook ingress', { n: group.partitionCount })
                : t('{n} shared webhook ingresses', { n: group.partitionCount }),
            items:
              group.expectedMemberCount === 1
                ? t('{n} monitored item', { n: group.expectedMemberCount })
                : t('{n} monitored items', { n: group.expectedMemberCount }),
          })}
        </p>
      </Field>

      <Field
        label={t('Message template')}
        htmlFor="trigger-group-message-template"
        hint={t(
          "Sent to the agent for the matched member on each fire. {placeholder} resolves against that provider's webhook body.",
          { placeholder: '`{{payload.foo}}`' },
        )}
      >
        <textarea
          id="trigger-group-message-template"
          value={form.messageTemplate}
          disabled={!canManage}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              messageTemplate: event.target.value,
            }))
          }
          rows={14}
          className="min-h-[220px] w-full resize-y rounded-md border border-zGray-800 bg-surface px-2.5 py-2 text-[13px] leading-relaxed text-main focus:border-zViolet-500 focus:outline-none"
        />
      </Field>
    </>
  )
}

export function GroupTestFireButton({
  canManage,
  action,
  allResourcesRecorded,
  groupActive,
  onTest,
}: {
  canManage: boolean
  action: 'test' | 'delete' | 'save' | null
  allResourcesRecorded: boolean
  groupActive: boolean
  onTest: () => void
}) {
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        onClick={onTest}
        disabled={!canManage || action !== null}
        variant="secondary"
        size="sm"
        title={
          !allResourcesRecorded
            ? t('Finish recording every provider ingress before testing')
            : !groupActive
              ? t('Enable the Group before testing')
              : t('Verify every shared ingress and send one non-incident destination test')
        }
      >
        {action === 'test' ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Play className="h-3.5 w-3.5" strokeWidth={1.8} />
        )}
        {t('Test fire')}
      </Button>
    </div>
  )
}

export function GroupOverviewFooter({
  canDelete,
  canSave,
  action,
  onDelete,
  onCancel,
  onSave,
}: {
  canDelete: boolean
  canSave: boolean
  action: 'test' | 'delete' | 'save' | null
  onDelete: () => void
  onCancel: () => void
  onSave: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-zGray-800 px-5 py-3">
      <div>
        {canDelete && (
          <Button
            type="button"
            onClick={onDelete}
            disabled={action !== null}
            variant="ghost"
            size="sm"
            className="text-error hover:text-error"
          >
            {action === 'delete' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
            )}
            {t('Delete')}
          </Button>
        )}
      </div>
      <div className="flex min-w-0 items-center justify-end gap-2">
        <Button
          type="button"
          onClick={onCancel}
          disabled={action !== null}
          variant="secondary"
          size="sm"
        >
          {t('Cancel')}
        </Button>
        <Button type="button" onClick={onSave} disabled={!canSave} size="sm">
          {action === 'save' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t('Save')}
        </Button>
      </div>
    </div>
  )
}
