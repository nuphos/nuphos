import {
  faArrowUpRightFromSquare,
  faComments,
  faHashtag,
  faLink,
} from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'
import { Fragment } from 'react'

import { Button } from '../../components/ui/button'
import { t } from '../../i18n'

import type { FormEvent, ReactNode } from 'react'

const inputClasses =
  'w-full h-9 rounded-md border border-zGray-800 bg-surface px-3 text-[13px] text-main outline-none transition-colors focus:border-zViolet-500/70 placeholder:text-tertiary'

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
      <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="h-2.5 w-2.5" />
      {installed ? t('Reinstall Slack App') : t('Install Slack App')}
    </Button>
  )
}

export function LinkChannelPanel({
  canManage,
  installed,
  oauthAvailable,
  botMention,
  botDmLink,
  onInstall,
  newChannelWorkspaceId,
  setNewChannelWorkspaceId,
  newChannelId,
  setNewChannelId,
  linkChannelSubmitting,
  onSubmit,
}: {
  canManage: boolean
  installed: boolean
  oauthAvailable: boolean
  botMention: string | null
  botDmLink: string | null
  onInstall: () => void
  newChannelWorkspaceId: string
  setNewChannelWorkspaceId: (value: string) => void
  newChannelId: string
  setNewChannelId: (value: string) => void
  linkChannelSubmitting: boolean
  onSubmit: (e: FormEvent) => Promise<void>
}) {
  // The command and the reply button are styled, so split one sentence around them.
  const mentionSteps = botMention
    ? t('Invite it ({command}), @mention it, then click {button} in its reply.')
    : t('Invite it, @mention it, then click {button} in its reply.')
  const mentionNodes: Record<string, ReactNode> = {
    '{command}': <span className="font-mono text-[11px]">/invite @{botMention}</span>,
    '{button}': <span className="text-secondary">Link this channel</span>,
  }

  return (
    <div className="divide-y divide-zGray-800/60 border-t border-zGray-800/60">
      <div className="flex items-start gap-3 px-4 py-3.5">
        <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-zGray-850">
          <FontAwesomeIcon icon={faHashtag} className="h-3.5 w-3.5 text-secondary" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-medium text-main">
            {t('Mention the bot in the channel')}
          </div>
          <div className="mt-0.5 text-[12px] text-tertiary">
            {mentionSteps.split(/(\{\w+\})/).map((part, i) => (
              <Fragment key={i}>{mentionNodes[part] ?? part}</Fragment>
            ))}
          </div>
        </div>
        {canManage && (
          <InstallButton
            oauthAvailable={oauthAvailable}
            installed={installed}
            onInstall={onInstall}
          />
        )}
      </div>

      <div className="flex items-start gap-3 px-4 py-3.5">
        <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-zGray-850">
          <FontAwesomeIcon icon={faComments} className="h-3.5 w-3.5 text-secondary" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-medium text-main">{t("Pick from the bot's DM")}</div>
          <div className="mt-0.5 text-[12px] text-tertiary">
            {t('Your DM with the bot has a channel picker for its own workspace.')}
          </div>
        </div>
        {botDmLink && (
          <button
            type="button"
            onClick={() => window.open(botDmLink, '_blank')}
            className="mt-1 inline-flex h-7 flex-shrink-0 items-center gap-1.5 rounded-md border border-zGray-800 px-2 text-[11.5px] text-secondary transition-colors hover:border-zGray-700 hover:text-main"
          >
            <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="h-2.5 w-2.5" />
            {t('Open DM')}
          </button>
        )}
        {canManage && !installed && (
          <InstallButton oauthAvailable={oauthAvailable} installed={false} onInstall={onInstall} />
        )}
      </div>

      <div className="flex items-start gap-3 px-4 py-3.5">
        <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-zGray-850">
          <FontAwesomeIcon icon={faLink} className="h-3.5 w-3.5 text-secondary" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-medium text-main">
            {t('Link by ID')}
            <span className="ml-2 rounded border border-zGray-700 px-1.5 py-0.5 text-[11px] font-normal text-tertiary">
              {t('admins')}
            </span>
          </div>
          <div className="mt-0.5 text-[12px] text-tertiary">
            {t(
              "Works for any workspace with a Nuphos installation. A channel in another team's workspace needs your linked Slack account to be a member of it.",
            )}
          </div>
          {canManage ? (
            <form
              onSubmit={(e) => void onSubmit(e)}
              className="mt-3 flex flex-wrap items-end gap-2"
            >
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
                <FontAwesomeIcon icon={faLink} className="h-3 w-3" />
                {linkChannelSubmitting ? t('Linking…') : t('Link channel')}
              </Button>
            </form>
          ) : (
            <div className="mt-1 text-[12px] text-tertiary">
              {t('Ask a team administrator to link it for you.')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
