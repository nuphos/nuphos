import {
  faRotateRight,
  faTrash,
  faChevronDown,
  faChevronUp,
  faPlus,
  faArrowUpRightFromSquare,
} from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'
import { useState } from 'react'

import { api } from '../api'
import { AppAlertDialog } from '../components/ui/alert-dialog'
import { toast } from '../components/ui/toast'

import { BindSlackDialog } from './BindSlackDialog'
import { ConnectionActions } from './messaging-settings/ConnectionActions'
import { LinkChannelPanel } from './slack-settings/LinkChannelPanel'
import { SlackAccountsCard } from './slack-settings/SlackAccountsCard'
import { useSlackSettings } from './slack-settings/useSlackSettings'

import type { SlackChannelMapping, SlackChannelOption } from '../types'

function channelLabel(
  mapping: SlackChannelMapping,
  channelsById: Map<string, SlackChannelOption>,
): string {
  const channel = mapping.channel ?? channelsById.get(mapping.slackChannelId)

  if (channel) {
    return channel.isPrivate ? `#${channel.name} (private)` : `#${channel.name}`
  }

  return mapping.slackChannelId
}

export function SlackSettingsView({
  teamId,
  currentUserId,
  embedded = false,
  onChanged,
}: {
  teamId: string | undefined
  currentUserId: string
  embedded?: boolean
  /** Invoked after a reinstall/disconnect so the parent's connector list re-syncs. */
  onChanged?: () => void
}) {
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false)
  const {
    installation,
    channelMappings,
    myMapping,
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
    memberById,
    channelsById,
    linkedAccountRows,
    defaultWorkspaceId,
    load,
    submitLinkChannel,
    deleteChannel,
  } = useSlackSettings(teamId, currentUserId)

  if (!teamId) {
    return <div className="text-[13px] text-tertiary">No workspace selected.</div>
  }

  const installed = !!installation || status?.installed === true
  // A stored binding whose token Slack no longer honours: only a reinstall
  // can repair it, so say so instead of leaving the page looking healthy.
  const tokenRevoked = !!installation && status?.installed === false

  async function disconnect() {
    if (!teamId) return
    try {
      await api.atlasDisconnectSlack(teamId)
    } catch (err) {
      toast.apiError('Could not disconnect Slack', err)

      return
    }
    toast.success('Slack disconnected')
    await load()
    onChanged?.()
  }
  // Slack users @mention the bot by its display name, not the internal user id
  // (U01ABC…), so prefer botName from auth.test and omit the hint otherwise.
  const botMention = status?.botName ?? null
  const botUserId = status?.botUserId ?? installation?.botUserId ?? null
  const botDmLink =
    botUserId && defaultWorkspaceId
      ? `slack://user?team=${defaultWorkspaceId}&id=${botUserId}`
      : null

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
        title="Disconnect Slack"
        description={`Disconnect ${installation?.slackTeamName ?? 'this Slack workspace'} from Nuphos? The bot token is revoked and channel links stop working until you install again.`}
        confirmLabel="Disconnect"
        destructive
        onConfirm={disconnect}
        onClose={() => setConfirmDisconnectOpen(false)}
      />
      <div className={clsx('flex items-start justify-between gap-3', embedded ? 'mb-3' : 'mb-6')}>
        {!embedded && (
          <div>
            <h1 className="text-[20px] font-semibold text-main">Slack</h1>
            <p className="mt-1 text-[13px] text-tertiary">
              Install Nuphos in Slack, pick channels from the bot DM, then @mention the agent in
              those channels.
            </p>
          </div>
        )}
        <div className={clsx('flex flex-shrink-0 items-center gap-2', embedded && 'ml-auto')}>
          {canManage && installed && (
            <ConnectionActions
              className="mt-0.5"
              primaryLabel="Reinstall"
              primaryDisabled={!oauthAvailable}
              primaryTitle={
                oauthAvailable ? undefined : 'Slack OAuth is not configured on this server yet.'
              }
              onPrimary={() => setInstallOpen(true)}
              onDisconnect={() => setConfirmDisconnectOpen(true)}
            />
          )}
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="mt-0.5 inline-flex h-8 flex-shrink-0 items-center gap-1.5 rounded-md border border-zGray-800 px-2.5 text-[12.5px] font-medium text-secondary transition-colors hover:border-zGray-700 hover:text-main disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FontAwesomeIcon
              icon={faRotateRight}
              className={clsx('h-3 w-3', loading && 'animate-spin')}
            />
            Refresh
          </button>
        </div>
      </div>
      {tokenRevoked && (
        <div className="mb-4 text-[12.5px] text-amber-300">
          Slack no longer accepts this installation's token — it was likely revoked or the app was
          removed from the workspace. Reinstall to restore the bot.
        </div>
      )}

      <div className="mb-8 overflow-hidden rounded-lg border border-zGray-800/70 bg-surface">
        <div className="border-b border-zGray-800/60 px-4 py-3">
          <div className="text-[13px] font-medium text-main">
            Linked channels
            {!loading && channelMappings.length > 0 && (
              <span className="ml-2 rounded-full border border-zGray-700 px-1.5 py-0.5 text-[11px] font-normal text-tertiary">
                {channelMappings.length}
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[12px] text-tertiary">
            Channels chosen in Slack or linked by an admin. The agent responds to @mentions here and
            can post notifications — including channels served by another workspace's installation.
          </div>
        </div>
        {loading ? (
          <div className="px-4 py-6 text-[13px] text-tertiary">Loading…</div>
        ) : channelMappings.length === 0 ? (
          <div className="px-4 py-6 text-[13px] text-tertiary">
            No channels linked yet. After installing, open your DM with the Nuphos bot and pick a
            channel.
          </div>
        ) : (
          <div className="divide-y divide-zGray-800/60">
            {channelMappings.map((mapping) => {
              return (
                <div key={mapping.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[12.5px] text-main">
                      <span className="truncate">{channelLabel(mapping, channelsById)}</span>
                      {mapping.workspace && !mapping.workspace.installed && (
                        <span className="flex-shrink-0 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-300">
                          workspace not installed
                        </span>
                      )}
                      {mapping.channel && !mapping.channel.botInChannel && (
                        <span className="flex-shrink-0 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-300">
                          bot not in channel
                        </span>
                      )}
                      {!mapping.enabled && (
                        <span className="flex-shrink-0 rounded border border-zGray-700 px-1.5 py-0.5 text-[11px] text-tertiary">
                          disabled
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-tertiary truncate">
                      {mapping.workspace?.name ?? mapping.slackWorkspaceId}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      window.open(
                        `https://app.slack.com/client/${mapping.slackWorkspaceId}/${mapping.slackChannelId}`,
                        '_blank',
                      )
                    }
                    className="inline-flex h-7 items-center gap-1.5 rounded-md border border-zGray-800 px-2 text-[11.5px] text-secondary transition-colors hover:border-zGray-700 hover:text-main"
                    title="Open this channel in Slack"
                  >
                    <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="h-2.5 w-2.5" />
                    Open
                  </button>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => void deleteChannel(mapping)}
                      disabled={busyKey === `channel:${mapping.id}`}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-tertiary transition-colors hover:bg-red-500/10 hover:text-error disabled:opacity-50"
                      title="Remove mapping"
                    >
                      <FontAwesomeIcon icon={faTrash} className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {!loading && (
          <div className="border-t border-zGray-800/60">
            <button
              type="button"
              onClick={() => setLinkChannelOpen((open) => !open)}
              className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-zGray-950/30"
            >
              <span className="inline-flex items-center gap-2 text-[12.5px] font-medium text-main">
                <FontAwesomeIcon icon={faPlus} className="h-3 w-3 text-tertiary" />
                Link a new channel
              </span>
              <FontAwesomeIcon
                icon={linkChannelOpen ? faChevronUp : faChevronDown}
                className="h-3 w-3 text-tertiary"
              />
            </button>
            {linkChannelOpen && (
              <LinkChannelPanel
                canManage={canManage}
                installed={installed}
                oauthAvailable={oauthAvailable}
                botMention={botMention}
                botDmLink={botDmLink}
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

      <SlackAccountsCard
        loading={loading}
        myMapping={myMapping}
        linkedAccountRows={linkedAccountRows}
        memberById={memberById}
        currentUserId={currentUserId}
        canManage={canManage}
      />
    </div>
  )
}
