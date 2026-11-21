import clsx from 'clsx'
import { Pencil as PencilIcon, Send as SendIcon, Trash2 as Trash2Icon } from 'lucide-react'

import { Button } from '../../components/ui/button'
import { Switch } from '../../components/ui/Switch'
import { UiIcon } from '../../components/ui/ui-icon'
import { t } from '../../i18n'

import type { TeamWebhook } from '../../types/webhooks'

function LastDelivery({ hook }: { hook: TeamWebhook }) {
  const last = hook.lastDelivery

  if (!last) return <>{t('No deliveries yet.')}</>
  const when = new Date(last.at).toLocaleString()

  return last.ok ? (
    <>
      {t('Last delivery succeeded {when} (HTTP {status}).', { when, status: String(last.status) })}
    </>
  ) : (
    <span className="text-status-danger">
      {t('Last delivery failed {when}: {error}', { when, error: last.error ?? '' })}
    </span>
  )
}

export function WebhookCard({
  hook,
  busy,
  onToggle,
  onTest,
  onEdit,
  onDelete,
}: {
  hook: TeamWebhook
  busy: boolean
  onToggle: (enabled: boolean) => void
  onTest: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div
      className={clsx(
        'rounded-xl border border-line-control p-4 transition-opacity',
        !hook.enabled && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-medium text-main">{hook.name}</p>
          <p className="mt-0.5 truncate font-mono text-[12px] text-tertiary">{hook.url}</p>
        </div>
        <Switch
          checked={hook.enabled}
          disabled={busy}
          onChange={onToggle}
          label={
            hook.enabled
              ? t('Disable {title}', { title: hook.name })
              : t('Enable {title}', { title: hook.name })
          }
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {hook.events.map((event) => (
          <span
            key={event}
            className="rounded-md bg-surface-sunken px-1.5 py-0.5 font-mono text-[11.5px] text-secondary"
          >
            {event}
          </span>
        ))}
      </div>
      <div className="mt-2 space-y-0.5 text-[12px] text-tertiary">
        {hook.headers.length > 0 && (
          <p>{t('Headers: {names}', { names: hook.headers.join(', ') })}</p>
        )}
        {hook.disabledReason && (
          <p className="text-status-danger">
            {t('Switched off: {reason}', { reason: hook.disabledReason })}
          </p>
        )}
        <p>
          <LastDelivery hook={hook} />
        </p>
      </div>
      <div className="mt-3 flex items-center justify-end gap-1">
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onTest}>
          <UiIcon size={16} icon={SendIcon} className="mr-1.5 h-4 w-4" />
          {t('Send test')}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
          <UiIcon size={16} icon={PencilIcon} className="mr-1.5 h-4 w-4" />
          {t('Edit')}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onDelete}>
          <UiIcon size={16} icon={Trash2Icon} className="mr-1.5 h-4 w-4" />
          {t('Delete')}
        </Button>
      </div>
    </div>
  )
}
