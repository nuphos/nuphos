import clsx from 'clsx'
import { AlertTriangle, Clock, Loader2, Webhook } from 'lucide-react'

import { useEffect, useState } from 'react'

import { api } from '../../api'
import { AppSelect } from '../../components/ui/select'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import { CronBuilder } from './CronBuilder'
import { ExecutionPrincipalBanner, Field, TypePill } from './parts'

import type { FormState } from './useTriggerFormController'
import type { AgentTrigger } from '../../api'
import type { TeamMember } from '../../types'

export function TriggerFormFields({
  mode,
  loaded,
  setLoaded,
  form,
  setForm,
  teamId,
  currentUserId,
  canManage,
  canDelete,
  cronEnabled,
  members,
  principalLabel,
}: {
  mode: 'create' | 'edit'
  loaded: AgentTrigger | null
  setLoaded: (trigger: AgentTrigger) => void
  form: FormState
  setForm: React.Dispatch<React.SetStateAction<FormState>>
  teamId?: string
  currentUserId?: string
  canManage: boolean
  canDelete: boolean
  cronEnabled: boolean | null
  members: TeamMember[]
  principalLabel: string | null
}) {
  return (
    <>
      {loaded?.teamId && principalLabel && (
        <ExecutionPrincipalBanner
          principalLabel={principalLabel}
          status={loaded.executionAuthorizationStatus}
          error={loaded.executionAuthorizationError}
          members={members}
          // A Group's ingresses share one identity, so those transfer at the
          // Group level instead.
          canTransfer={canDelete && !loaded.watchGroupId}
          onTransfer={async (userId) => {
            try {
              setLoaded(
                await api.agentTransferTriggerExecutionPrincipal(loaded.id, userId, loaded.teamId),
              )
            } catch (err) {
              toast.apiError(t('Could not transfer this trigger'), err)
            }
          }}
        />
      )}
      {!canManage && (
        <div className="rounded-md border border-zGray-800 bg-zGray-950 px-3 py-2 text-[11.5px] text-tertiary">
          {t(
            'You can view this team trigger. Editor or administrator access is required to change or test it.',
          )}
        </div>
      )}
      {loaded?.cleanupStatus && (
        <div
          className={clsx(
            'flex items-start gap-2 rounded-md border px-3 py-2 text-[12px]',
            loaded.cleanupStatus === 'deleting'
              ? 'border-zViolet-500/40 bg-zViolet-500/10 text-zViolet-accent'
              : 'border-error/40 bg-error/10 text-error',
          )}
          role="status"
        >
          {loaded.cleanupStatus === 'deleting' ? (
            <Loader2 className="w-3.5 h-3.5 flex-shrink-0 mt-px animate-spin" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
          )}
          <span className="leading-snug">
            {loaded.cleanupStatus === 'deleting'
              ? t(
                  'Removing this Watch and its owned provider resources. You can close this window.',
                )
              : t('Provider cleanup needs attention. Retry cleanup below.')}
          </span>
        </div>
      )}
      <Field label={t('Name')} htmlFor="trigger-name">
        <input
          id="trigger-name"
          type="text"
          value={form.name}
          disabled={!canManage}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          maxLength={100}
          placeholder={t('Daily standup summary')}
          className="w-full h-8 px-2.5 rounded-md bg-surface border border-zGray-800 text-[13px] text-main focus:outline-none focus:border-zViolet-500"
        />
      </Field>

      <Field label={t('Type')}>
        <div className="flex gap-2" role="group" aria-label={t('Trigger type')}>
          <TypePill
            icon={Clock}
            label="Cron"
            active={form.triggerType === 'cron'}
            disabled={mode === 'edit' || !canManage}
            onClick={() => setForm((f) => ({ ...f, triggerType: 'cron' }))}
          />
          <TypePill
            icon={Webhook}
            label="Webhook"
            active={form.triggerType === 'webhook'}
            disabled={mode === 'edit' || !canManage}
            onClick={() => setForm((f) => ({ ...f, triggerType: 'webhook' }))}
          />
        </div>
        {mode === 'edit' && (
          <p className="text-[11.5px] text-tertiary mt-1.5">
            {t("Type can't change after creation — delete and recreate to switch.")}
          </p>
        )}
      </Field>

      {form.triggerType === 'cron' && (
        <>
          {cronEnabled === false && (
            <div
              className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[12px] text-warning"
              role="status"
            >
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" strokeWidth={2} />
              <span className="leading-snug">
                {t(
                  "The cron scheduler is offline (Redis not configured on the backend). You can save this trigger, but it won't fire automatically until the scheduler is enabled. Test fire from the edit view still works.",
                )}
              </span>
            </div>
          )}
          <Field label={t('Schedule (UTC)')}>
            <fieldset disabled={!canManage}>
              <CronBuilder
                value={form.cronExpression}
                onChange={(expr) => setForm((f) => ({ ...f, cronExpression: expr }))}
              />
            </fieldset>
          </Field>
        </>
      )}

      {teamId && canBind(mode, loaded, currentUserId) && (
        <DeliverToField
          teamId={teamId}
          value={form.targetSessionId}
          disabled={!canManage}
          onChange={(targetSessionId) => setForm((f) => ({ ...f, targetSessionId }))}
        />
      )}

      <Field
        label={t('Message template')}
        htmlFor="trigger-message-template"
        hint={
          form.triggerType === 'webhook'
            ? t(
                'Sent to the agent on each fire. {placeholder} resolves against the webhook body.',
                { placeholder: '`{{payload.foo}}`' },
              )
            : t('Sent to the agent on each fire. {name} / {firedAt} are available.', {
                name: '`{{trigger.name}}`',
                firedAt: '`{{trigger.firedAt}}`',
              })
        }
      >
        <textarea
          id="trigger-message-template"
          value={form.messageTemplate}
          disabled={!canManage}
          onChange={(e) => setForm((f) => ({ ...f, messageTemplate: e.target.value }))}
          // This is the whole brief the agent runs on — in practice a dozen
          // lines of rules, not one sentence — so it gets the room to be read
          // without scrolling, and stays resizable for the ones that don't fit.
          rows={14}
          placeholder={
            form.triggerType === 'webhook'
              ? t('A deploy just finished: {event}. Investigate the latest commits.', {
                  event: '{{payload.event}}',
                })
              : t('Summarise yesterday’s open PRs across our repos.')
          }
          className="w-full min-h-[220px] resize-y px-2.5 py-2 rounded-md bg-surface border border-zGray-800 text-[13px] leading-relaxed text-main focus:outline-none focus:border-zViolet-500"
        />
      </Field>
    </>
  )
}

/**
 * A bound fire runs with the session's own credentials, so only the trigger's
 * principal may pick one, and never on a routed, grouped or incident trigger.
 */
function canBind(mode: 'create' | 'edit', loaded: AgentTrigger | null, viewerId?: string) {
  if (mode === 'create') return true
  if (!loaded || loaded.watchGroupId || loaded.incidentMode || loaded.sessionRouting) return false

  return (loaded.executionPrincipalUserId ?? loaded.createdByUserId ?? loaded.userId) === viewerId
}

const NEW_CONVERSATION = { value: '', label: t('A new agent each fire') }

/** Where a fire lands: a fresh run, or one of the viewer's own sessions. */
function DeliverToField({
  teamId,
  value,
  disabled,
  onChange,
}: {
  teamId: string
  value: string
  disabled: boolean
  onChange: (sessionId: string) => void
}) {
  const [sessions, setSessions] = useState<{ value: string; label: string }[]>([])

  useEffect(() => {
    let cancelled = false

    api
      .agentListConversations(teamId, { scope: 'mine', limit: 50, archived: 'exclude' })
      .then((page) => {
        if (!cancelled)
          setSessions(
            page.conversations.map((c) => ({
              value: c.sessionId,
              label: c.title || t('Untitled'),
            })),
          )
      })
      .catch((err: unknown) => toast.apiError(t('Could not load your agents'), err))

    return () => {
      cancelled = true
    }
  }, [teamId])

  const options = [NEW_CONVERSATION, ...sessions]

  // A bound session older than the first page still has to read as itself.
  if (value && !sessions.some((s) => s.value === value))
    options.push({ value, label: t('Current agent (not in your recent 50)') })

  return (
    <Field
      label={t('Deliver to')}
      htmlFor="trigger-deliver-to"
      hint={
        value
          ? t(
              'Each fire is posted into this agent as an event. While it is busy, fires wait and run once after the current turn.',
            )
          : t('Each fire starts its own agent, listed under this trigger.')
      }
    >
      <AppSelect
        id="trigger-deliver-to"
        value={value}
        options={options}
        disabled={disabled}
        onValueChange={onChange}
      />
    </Field>
  )
}
