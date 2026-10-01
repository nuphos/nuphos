import { Dialog } from '@base-ui/react/dialog'
import { Loader2, X } from 'lucide-react'

import { ConfirmDialog } from '../components/ConfirmDialog'

import { EXTRACTS, OPS, useAlertEditor } from './AlertModalState'

import type { PanelAlertExtract, PanelAlertOp, DashboardPanel } from './schema'

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

  const field =
    'w-full rounded-md border border-zGray-800 bg-zGray-900 px-2.5 py-1.5 text-[13px] text-main outline-none focus:border-zViolet-500'
  const channelPlaceholder =
    channelType === 'slack'
      ? 'C0123ABC (channel id)'
      : channelType === 'discord'
        ? 'https://discord.com/api/webhooks/…'
        : 'a@team.com, b@team.com'

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
                Alert · {panel.title}
              </Dialog.Title>
              <Dialog.Close
                className="rounded p-1 text-tertiary hover:bg-zGray-800 hover:text-main"
                aria-label="Close alert editor"
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
                  Enabled
                </label>
                <div>
                  <span className="mb-1 block text-[11px] uppercase tracking-wide text-tertiary">
                    Watch
                  </span>
                  <select
                    className={field}
                    name="panel-alert-extract"
                    aria-label="Metric to watch"
                    value={extract}
                    onChange={(e) => setExtract(e.target.value as PanelAlertExtract)}
                  >
                    {EXTRACTS.filter((x) => x.kinds.includes(panel.kind)).map((x) => (
                      <option key={x.value} value={x.value}>
                        {x.label}
                      </option>
                    ))}
                  </select>
                </div>
                {(extract === 'series-last' ||
                  extract === 'series-sum' ||
                  extract === 'column-sum') && (
                  <input
                    className={field}
                    name="panel-alert-reference"
                    aria-label="Series or column key"
                    autoComplete="off"
                    placeholder="series/column key (optional — defaults to first)"
                    value={ref}
                    onChange={(e) => setRef(e.target.value)}
                  />
                )}
                <div className="flex gap-2">
                  <select
                    className={field}
                    name="panel-alert-operator"
                    aria-label="Comparison operator"
                    value={op}
                    onChange={(e) => setOp(e.target.value as PanelAlertOp)}
                  >
                    {OPS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <input
                    className={`${field} w-28`}
                    name="panel-alert-threshold"
                    aria-label="Threshold"
                    autoComplete="off"
                    type="number"
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value)}
                  />
                </div>
                <div>
                  <span className="mb-1 block text-[11px] uppercase tracking-wide text-tertiary">
                    Notify via
                  </span>
                  <div className="flex gap-2">
                    <select
                      className={`${field} w-32`}
                      name="panel-alert-channel-type"
                      aria-label="Notification channel type"
                      value={channelType}
                      onChange={(e) => {
                        setChannelType(e.target.value as typeof channelType)
                        setChannelValue('')
                      }}
                    >
                      <option value="slack">Slack</option>
                      <option value="discord">Discord</option>
                      <option value="email">Email</option>
                    </select>
                    <input
                      className={field}
                      name="panel-alert-destination"
                      aria-label="Notification destination"
                      autoComplete="off"
                      placeholder={channelPlaceholder}
                      value={channelValue}
                      onChange={(e) => setChannelValue(e.target.value)}
                    />
                  </div>
                  {extraChannels.length > 0 && (
                    <p className="mt-1 text-[11px] text-tertiary">
                      {extraChannels.length} other destination
                      {extraChannels.length === 1 ? '' : 's'} (
                      {extraChannels.map((c) => c.type).join(', ')}) stay as configured.
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
                Remove
              </button>
              <div className="flex gap-2">
                <Dialog.Close className="rounded-md px-3 py-1.5 text-[13px] text-secondary hover:bg-zGray-800">
                  Cancel
                </Dialog.Close>
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-md bg-zViolet-500 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-zViolet-400 disabled:opacity-50"
                  disabled={saving || loadFailed || !channelValue.trim()}
                  onClick={() => void save()}
                >
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save alert
                </button>
              </div>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
      <ConfirmDialog
        open={confirmingRemove}
        title="Remove alert?"
        description={`The alert for "${panel.title}" and all of its notification destinations will be permanently removed.`}
        confirmLabel="Remove alert"
        destructive
        onConfirm={remove}
        onClose={() => setConfirmingRemove(false)}
      />
    </Dialog.Root>
  )
}
