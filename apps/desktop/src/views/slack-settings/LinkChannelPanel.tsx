import clsx from 'clsx'
import { ExternalLink as ExternalLinkIcon, Link as LinkIcon } from 'lucide-react'

import { Button } from '../../components/ui/button'
import { UiIcon } from '../../components/ui/ui-icon'
import { t } from '../../i18n'

import type { FormEvent } from 'react'

const inputClasses =
  'w-full h-9 rounded-md border border-line-control bg-surface px-3 text-[13px] text-main outline-none transition-colors focus:border-line-focus placeholder:text-tertiary'

function InstallButton({
  oauthAvailable,
  installed,
  onInstall,
}: {
  oauthAvailable: boolean
  installed: boolean
  onInstall: () => void
}) {
  return (
    <Button
      size="sm"
      className="mt-1 flex-shrink-0"
      type="button"
      onClick={onInstall}
      disabled={!oauthAvailable}
      title={oauthAvailable ? undefined : t('Slack OAuth is not configured on this server yet.')}
    >
      <UiIcon size={16} icon={ExternalLinkIcon} className="h-4 w-4" />
      {installed ? t('Reinstall Slack App') : t('Install Slack App')}
    </Button>
  )
}

export function LinkChannelPanel({
  installed,
  oauthAvailable,
  onInstall,
  newChannelWorkspaceId,
  setNewChannelWorkspaceId,
  newChannelId,
  setNewChannelId,
  linkChannelSubmitting,
  onSubmit,
}: {
  installed: boolean
  oauthAvailable: boolean
  onInstall: () => void
  newChannelWorkspaceId: string
  setNewChannelWorkspaceId: (value: string) => void
  newChannelId: string
  setNewChannelId: (value: string) => void
  linkChannelSubmitting: boolean
  onSubmit: (e: FormEvent) => Promise<void>
}) {
  return (
    <div className="divide-y divide-line-control/60 border-t border-line-control/60">
      <div className="flex items-start gap-3 px-4 py-3.5">
        <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-surface-sunken">
          <UiIcon size={14} icon={LinkIcon} className="h-3.5 w-3.5 text-secondary" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-medium text-main">{t('Link by ID')}</div>
          <div className="mt-0.5 text-[12px] text-tertiary">
            {t(
              "Works for any workspace with a Nuphos installation. A channel in another team's workspace needs your linked Slack account to be a member of it.",
            )}
          </div>
          <form onSubmit={(e) => void onSubmit(e)} className="mt-3 flex flex-wrap items-end gap-2">
            <label className="min-w-[140px] flex-1">
              <span className="mb-1 block text-[11.5px] text-tertiary">{t('Workspace ID')}</span>
              <input
                value={newChannelWorkspaceId}
                onChange={(e) => setNewChannelWorkspaceId(e.target.value)}
                placeholder="T01ABCDEF"
                className={clsx(inputClasses, 'font-mono')}
              />
            </label>
            <label className="min-w-[140px] flex-1">
              <span className="mb-1 block text-[11.5px] text-tertiary">{t('Channel ID')}</span>
              <input
                value={newChannelId}
                onChange={(e) => setNewChannelId(e.target.value)}
                placeholder="C01ABCDEF"
                className={clsx(inputClasses, 'font-mono')}
              />
            </label>
            <Button
              size="sm"
              type="submit"
              disabled={
                !newChannelWorkspaceId.trim() || !newChannelId.trim() || linkChannelSubmitting
              }
            >
              <UiIcon size={16} icon={LinkIcon} className="h-4 w-4" />
              {linkChannelSubmitting ? t('Linking…') : t('Link channel')}
            </Button>
          </form>
        </div>
        <InstallButton
          oauthAvailable={oauthAvailable}
          installed={installed}
          onInstall={onInstall}
        />
      </div>
    </div>
  )
}
