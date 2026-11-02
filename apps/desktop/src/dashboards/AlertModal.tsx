import { Dialog } from '@base-ui/react/dialog'
import { Loader2, X } from 'lucide-react'

import { ConfirmDialog } from '../components/ConfirmDialog'
import { Button } from '../components/ui/button'
import { fieldClass } from '../components/ui/input-group'
import { AppSelect } from '../components/ui/select'
import { t } from '../i18n'

import { EXTRACTS, OPS, useAlertEditor } from './AlertModalState'

import type { PanelAlertExtract, PanelAlertOp, DashboardPanel } from './schema'

const CHANNEL_TYPES = [
  { value: 'slack', label: 'Slack' },
  { value: 'discord', label: 'Discord' },
  { value: 'email', label: t('Email') },
]

type Props = {
  teamId: string
  dashboardId: string
  panel: DashboardPanel
  onClose: () => void
}

export function AlertModal({ teamId, dashboardId, panel, onClose }: Props) {
  const editor = useAlertEditor(teamId, dashboardId, panel, onClose)
  const {
    loading,
    loadFailed,
    saving,
    confirmingRemove,
    setConfirmingRemove,
    hasAlert,
    enabled,
    setEnabled,
    extract,
    setExtract,
    ref,
    setRef,
    op,
    setOp,
    threshold,
    setThreshold,
    channelType,
    setChannelType,
    channelValue,
    setChannelValue,
    extraChannels,
    save,
    remove,
  } = editor

  const channelPlaceholder =
    channelType === 'slack'
      ? t('C0123ABC (channel id)')
      : channelType === 'discord'
        ? 'https://discord.com/api/webhooks/…'
        : 'a@team.com, b@team.com'

  const extraVars = {
    count: extraChannels.length,
    types: extraChannels.map((c) => c.type).join(', '),
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        {/* z-[1000]+ is the app's popup tier — see PanelEditorModal for why
            anything under 999 gets swallowed by Base UI's internal backdrop. */}
        <Dialog.Backdrop className="fixed inset-0 z-[1000] bg-black/50" />
        <Dialog.Viewport className="fixed inset-0 z-[1001] flex items-center justify-center p-6">
          <Dialog.Popup className="relative flex w-full max-w-md flex-col overflow-hidden rounded-xl border border-zGray-800 bg-zGray-950 shadow-2xl outline-none">
            <div className="flex items-center justify-between border-b border-zGray-800 px-4 py-3">
              <Dialog.Title className="text-[14px] font-medium text-main">
                {t('Alert · {title}', { title: panel.title })}
              </Dialog.Title>
              <Dialog.Close
                className="rounded p-1 text-tertiary hover:bg-zGray-800 hover:text-main"
                aria-label={t('Close alert editor')}
              >
                <X className="h-4 w-4" />
              </Dialog.Close>
            </div>
            {loading ? (
              <div className="flex h-40 items-center justify-center text-tertiary">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : (
              <div className="flex flex-col gap-3 px-4 py-3">
                <label className="flex items-center gap-2 text-[13px] text-secondary">
                  <input
                    type="checkbox"
                    name="panel-alert-enabled"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                  />{' '}
                  {t('Enabled')}
                </label>
                <div>
                  <span className="mb-1 block text-[11px] uppercase tracking-wide text-tertiary">
                    {t('Watch')}
                  </span>
                  <AppSelect
                    positionerClassName="!z-[1100]"
                    ariaLabel={t('Metric to watch')}
                    value={extract}
                    onValueChange={(value) => setExtract(value as PanelAlertExtract)}
                    options={EXTRACTS.filter((x) => x.kinds.includes(panel.kind))}
                  />
                </div>
                {(extract === 'series-last' ||
                  extract === 'series-sum' ||
                  extract === 'column-sum') && (
                  <input
                    className={`${fieldClass} h-9`}
                    name="panel-alert-reference"
                    aria-label={t('Series or column key')}
                    autoComplete="off"
                    placeholder={t('series/column key (optional — defaults to first)')}
                    value={ref}
                    onChange={(e) => setRef(e.target.value)}
                  />
                )}
                <div className="flex gap-2">
                  <AppSelect
                    positionerClassName="!z-[1100]"
                    ariaLabel={t('Comparison operator')}
                    value={op}
                    onValueChange={(value) => setOp(value as PanelAlertOp)}
                    options={OPS}
                    className="w-full"
                  />
                  <input
                    className={`${fieldClass} h-9 w-28`}
                    name="panel-alert-threshold"
                    aria-label={t('Threshold')}
                    autoComplete="off"
                    type="number"
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value)}
                  />
                </div>
                <div>
                  <span className="mb-1 block text-[11px] uppercase tracking-wide text-tertiary">
                    {t('Notify via')}
                  </span>
                  <div className="flex gap-2">
                    <AppSelect
                      positionerClassName="!z-[1100]"
                      ariaLabel={t('Notification channel type')}
                      value={channelType}
                      onValueChange={(value) => {
                        setChannelType(value as typeof channelType)
                        setChannelValue('')
                      }}
                      options={CHANNEL_TYPES}
                      className="w-full"
                    />
                    <input
                      className={`${fieldClass} h-9`}
                      name="panel-alert-destination"
                      aria-label={t('Notification destination')}
                      autoComplete="off"
                      placeholder={channelPlaceholder}
                      value={channelValue}
                      onChange={(e) => setChannelValue(e.target.value)}
                    />
                  </div>
                  {extraChannels.length > 0 && (
                    <p className="mt-1 text-[11px] text-tertiary">
                      {extraChannels.length === 1
                        ? t('{count} other destination ({types}) stays as configured.', extraVars)
                        : t('{count} other destinations ({types}) stay as configured.', extraVars)}
                    </p>
                  )}
                </div>
              </div>
            )}
            <div className="flex justify-between border-t border-zGray-800 px-4 py-3">
              <button
                type="button"
                className="rounded-md px-3 py-1.5 text-[13px] text-orange-400 hover:bg-zGray-800 disabled:opacity-50"
                onClick={() => setConfirmingRemove(true)}
                disabled={saving || loadFailed || !hasAlert}
              >
                {t('Remove')}
              </button>
              <div className="flex gap-2">
                <Dialog.Close className="rounded-md px-3 py-1.5 text-[13px] text-secondary hover:bg-zGray-800">
                  {t('Cancel')}
                </Dialog.Close>
                <Button
                  size="sm"
                  type="button"
                  disabled={saving || loadFailed || !channelValue.trim()}
                  onClick={() => void save()}
                >
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {t('Save alert')}
                </Button>
              </div>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
      <ConfirmDialog
        open={confirmingRemove}
        title={t('Remove alert?')}
        description={t(
          'The alert for "{title}" and all of its notification destinations will be permanently removed.',
          { title: panel.title },
        )}
        confirmLabel={t('Remove alert')}
        destructive
        onConfirm={remove}
        onClose={() => setConfirmingRemove(false)}
      />
    </Dialog.Root>
  )
}
