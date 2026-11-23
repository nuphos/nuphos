import clsx from 'clsx'
import {
  RotateCw as RotateCwIcon,
  Trash2 as Trash2Icon,
  ChevronDown as ChevronDownIcon,
  ChevronUp as ChevronUpIcon,
  Plus as PlusIcon,
  ExternalLink as ExternalLinkIcon,
} from 'lucide-react'
import { useState } from 'react'

import { api } from '../api'
import { AppAlertDialog } from '../components/ui/alert-dialog'
import { toast } from '../components/ui/toast'
import { UiIcon } from '../components/ui/ui-icon'
import { t } from '../i18n'

import { BindSlackDialog } from './BindSlackDialog'
import { ConnectionActions } from './messaging-settings/ConnectionActions'
import { ChannelBots } from './slack-settings/ChannelBots'
import { LinkChannelPanel } from './slack-settings/LinkChannelPanel'
import { useSlackSettings } from './slack-settings/useSlackSettings'

import type { SlackChannelMapping, SlackChannelOption } from '../types'

const WARN_BADGE =
  'flex-shrink-0 rounded border border-status-warning/40 bg-status-warning/10 px-1.5 py-0.5 text-[11px] text-status-warning'
const MUTED_BADGE =
  'flex-shrink-0 rounded border border-line-control px-1.5 py-0.5 text-[11px] text-tertiary'

function channelLabel(
  mapping: SlackChannelMapping,
  channelsById: Map<string, SlackChannelOption>,
): string {
  const channel = mapping.channel ?? channelsById.get(mapping.slackChannelId)

  if (!channel) return mapping.slackChannelId

  return channel.isPrivate ? t('#{name} (private)', { name: channel.name }) : `#${channel.name}`
}

export function SlackSettingsView({
  teamId,
  currentUserId,
  embedded = false,
  onChanged,
}: {
  teamId: string
  currentUserId: string
  embedded?: boolean
  /** Invoked after a reinstall/disconnect so the parent's connector list re-syncs. */
  onChanged?: () => void
}) {
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false)
  const {
    installation,
    channelMappings,
    myBots,
    setChannelBot,
    status,
    loading,
    busyKey,
    installOpen,
    setInstallOpen,
    oauthAvailable,
    linkChannelOpen,
    setLinkChannelOpen,
    newChannelWorkspaceId,
    setNewChannelWorkspaceId,
    newChannelId,
    setNewChannelId,
    linkChannelSubmitting,
    canManage,
    channelsById,
    load,
    submitLinkChannel,
    deleteChannel,
  } = useSlackSettings(teamId, currentUserId)

  const installed = Boolean(installation) || status?.installed === true
  // Revoked Slack tokens require reinstalling the stored binding.
  const tokenRevoked = Boolean(installation) && status?.installed === false

  async function disconnect() {
    try {
      await api.atlasDisconnectSlack(teamId)
    } catch (err) {
      toast.apiError(t('Could not disconnect {name}', { name: 'Slack' }), err)

      return
    }
    toast.success(t('{name} disconnected', { name: 'Slack' }))
    await load()
    onChanged?.()
  }

  return (
    <div>
      <BindSlackDialog
        open={installOpen}
        teamId={teamId}
        mode={installed ? 'reinstall' : 'install'}
        onClose={() => setInstallOpen(false)}
        onBound={() => {
          void load()
          onChanged?.()
        }}
      />
      <AppAlertDialog
        open={confirmDisconnectOpen}
        title={t('Disconnect {name}', { name: 'Slack' })}
        description={t(
          'Disconnect {name} from Nuphos? The bot token is revoked and channel links stop working until you install again.',
          { name: installation?.slackTeamName ?? 'Slack' },
        )}
        confirmLabel={t('Disconnect')}
        destructive
        onConfirm={disconnect}
        onClose={() => setConfirmDisconnectOpen(false)}
      />
      <div className={clsx('flex items-start justify-between gap-3', embedded ? 'mb-3' : 'mb-6')}>
        {!embedded && (
          <div>
            <h1 className="text-[20px] font-semibold text-main">Slack</h1>
            <p className="mt-1 text-[13px] text-tertiary">
              {t(
                'Install Nuphos in Slack, connect channels here, and choose the Bot that answers in each one.',
              )}
            </p>
          </div>
        )}
        <div className={clsx('flex flex-shrink-0 items-center gap-2', embedded && 'ml-auto')}>
          {canManage && installed && (
            <ConnectionActions
              className="mt-0.5"
              primaryLabel={t('Reinstall')}
              primaryDisabled={!oauthAvailable}
              primaryTitle={
                oauthAvailable ? undefined : t('Slack OAuth is not configured on this server yet.')
              }
              onPrimary={() => setInstallOpen(true)}
              onDisconnect={() => setConfirmDisconnectOpen(true)}
            />
          )}
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="mt-0.5 inline-flex h-8 flex-shrink-0 items-center gap-1.5 rounded-md border border-line-control px-2.5 text-[12.5px] font-medium text-secondary transition-colors hover:border-line-control hover:text-main disabled:cursor-not-allowed disabled:opacity-50"
          >
            <UiIcon
              size={16}
              icon={RotateCwIcon}
              className={clsx('h-4 w-4', loading && 'animate-spin')}
            />
            {t('Refresh')}
          </button>
        </div>
      </div>
      {tokenRevoked && (
        <div className="mb-4 text-[12.5px] text-status-warning">
          {t(
            "Slack no longer accepts this installation's token — it was likely revoked or the app was removed from the workspace. Reinstall to restore the bot.",
          )}
        </div>
      )}
      <div className="mb-8 overflow-hidden rounded-lg border border-line-control/70 bg-surface">
        <div className="border-b border-line-control/60 px-4 py-3">
          <div className="text-[13px] font-medium text-main">
            {t('Connected channels')}
            {!loading && channelMappings.length > 0 && (
              <span className="ml-2 rounded-full border border-line-control px-1.5 py-0.5 text-[11px] font-normal text-tertiary">
                {channelMappings.length}
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[12px] text-tertiary">
            {t(
              'Each channel has one Bot, which reads every message there and answers in Slack. A team admin connects channels; a member chooses their own Bot for a channel without a teammate’s.',
            )}
          </div>
        </div>
        {loading ? (
          <div className="px-4 py-6 text-[13px] text-tertiary">{t('Loading…')}</div>
        ) : channelMappings.length === 0 ? (
          <div className="px-4 py-6 text-[13px] text-tertiary">
            {t('No channels connected yet. A team admin connects one by its ID below.')}
          </div>
        ) : (
          <div className="divide-y divide-line-control/60">
            {channelMappings.map((mapping) => (
              <div key={mapping.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[12.5px] text-main">
                    <span className="truncate">{channelLabel(mapping, channelsById)}</span>
                    {mapping.workspace && !mapping.workspace.installed && (
                      <span className={WARN_BADGE}>{t('workspace not installed')}</span>
                    )}
                    {mapping.channel && !mapping.channel.botInChannel && (
                      <span className={WARN_BADGE}>{t('bot not in channel')}</span>
                    )}
                    {!mapping.enabled && <span className={MUTED_BADGE}>{t('disabled')}</span>}
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-tertiary truncate">
                    {mapping.workspace?.name ?? mapping.slackWorkspaceId}
                  </div>
                  <ChannelBots
                    mapping={mapping}
                    myBots={myBots}
                    busyKey={busyKey}
                    onChange={(botSessionId, answers) =>
                      void setChannelBot(mapping, botSessionId, answers)
                    }
                  />
                </div>
                <button
                  type="button"
                  onClick={() =>
                    window.open(
                      `https://app.slack.com/client/${mapping.slackWorkspaceId}/${mapping.slackChannelId}`,
                      '_blank',
                    )
                  }
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line-control px-2 text-[11.5px] text-secondary transition-colors hover:border-line-control hover:text-main"
                  title={t('Open this channel in Slack')}
                >
                  <UiIcon size={16} icon={ExternalLinkIcon} className="h-4 w-4" />
                  {t('Open')}
                </button>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => void deleteChannel(mapping)}
                    disabled={busyKey === `channel:${mapping.id}`}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-tertiary transition-colors hover:bg-status-danger/10 hover:text-error disabled:opacity-50"
                    title={t('Disconnect this channel')}
                  >
                    <UiIcon size={16} icon={Trash2Icon} className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {/* Only an admin connects channels; members bring their Bots on the rows above. */}
        {!loading && canManage && (
          <div className="border-t border-line-control/60">
            <button
              type="button"
              onClick={() => setLinkChannelOpen((open) => !open)}
              className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-state-hover"
            >
              <span className="inline-flex items-center gap-2 text-[12.5px] font-medium text-main">
                <UiIcon size={16} icon={PlusIcon} className="h-4 w-4 text-tertiary" />
                {t('Connect a channel')}
              </span>
              <UiIcon
                size={16}
                icon={linkChannelOpen ? ChevronUpIcon : ChevronDownIcon}
                className="h-4 w-4 text-tertiary"
              />
            </button>
            {linkChannelOpen && (
              <LinkChannelPanel
                installed={installed}
                oauthAvailable={oauthAvailable}
                onInstall={() => setInstallOpen(true)}
                newChannelWorkspaceId={newChannelWorkspaceId}
                setNewChannelWorkspaceId={setNewChannelWorkspaceId}
                newChannelId={newChannelId}
                setNewChannelId={setNewChannelId}
                linkChannelSubmitting={linkChannelSubmitting}
                onSubmit={submitLinkChannel}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
