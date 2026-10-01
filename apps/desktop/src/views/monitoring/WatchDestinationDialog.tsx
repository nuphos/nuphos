import { Dialog } from '@base-ui/react/dialog'
import { RadioGroup } from '@base-ui/react/radio-group'
import { faSlack } from '@fortawesome/free-brands-svg-icons'
import { faInbox, faUser, faXmark } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useEffect, useState } from 'react'

import { api } from '../../api'
import { parseAtlasError } from '../../api/errors'
import { AppSelect } from '../../components/ui/select'
import { toast } from '../../components/ui/toast'
import { slackDmRecipientCopy } from '../../lib/monitoringWatch'

import { WatchDestinationCard } from './WatchDestinationCard'

import type { WatchDestination } from '../../lib/monitoringWatch'
import type { SlackChannelOption, SlackUserMapping } from '../../types'

export type WatchDestinationDialogProps = {
  subjectName: string
  teamId: string
  group?: { memberCount: number; defaultName: string }
  onClose: () => void
  onContinue: (destination: WatchDestination, groupName?: string) => void
}

/**
 * "This server has no Slack set up", as opposed to "your Slack broke".
 *
 * A deployment without SLACK_TOKEN_ENCRYPTION_KEY cannot read stored tokens at
 * all — the backend says so with a 503 `credential_key_unavailable`. That is a
 * configuration fact, not a failure the reader can act on, so it belongs in the
 * dialog's existing "Connect Slack in Settings" state rather than in a red
 * toast fired twice on open.
 */
function isSlackUnconfigured(err: unknown): boolean {
  return parseAtlasError(err).code === 'credential_key_unavailable'
}

export function WatchDestinationDialog({
  subjectName,
  teamId,
  group,
  onClose,
  onContinue,
}: WatchDestinationDialogProps) {
  const [groupName, setGroupName] = useState(group?.defaultName ?? '')
  const [destination, setDestination] = useState<WatchDestination['type']>('nuphos')
  const [channels, setChannels] = useState<SlackChannelOption[]>([])
  const [channelId, setChannelId] = useState('')
  const [slackConnected, setSlackConnected] = useState(false)
  const [channelGrantOnly, setChannelGrantOnly] = useState(false)
  const [dmRecipient, setDmRecipient] = useState<SlackUserMapping | null>(null)
  const [loadingSlack, setLoadingSlack] = useState(true)

  useEffect(() => {
    let active = true

    void (async () => {
      try {
        const { installation } = await api.atlasGetSlackInstallation(teamId)

        if (!active) return
        if (!installation) {
          // No installation of its own — the team may still have
          // channel-scoped access through channels linked to it from another
          // workspace. A 503 here is just "no Slack at all"; stay quiet.
          const grantChannels = await api.atlasListSlackChannels(teamId).catch(() => null)

          if (!active || !grantChannels || grantChannels.channels.length === 0) return
          setSlackConnected(true)
          setChannelGrantOnly(true)
          setChannels(grantChannels.channels)
          setChannelId(grantChannels.channels[0]?.id ?? '')

          return
        }
        setSlackConnected(true)
        const [channelResult, selfMapping] = await Promise.allSettled([
          api.atlasListSlackChannels(teamId),
          api.atlasGetMySlackUserMapping(teamId),
        ])

        if (!active) return
        // One unconfigured server produces two failures; fold them into the
        // single "not connected" state instead of two toasts saying the same
        // thing, and drop the installation that can't be read.
        if (
          (channelResult.status === 'rejected' && isSlackUnconfigured(channelResult.reason)) ||
          (selfMapping.status === 'rejected' && isSlackUnconfigured(selfMapping.reason))
        ) {
          setSlackConnected(false)

          return
        }
        if (channelResult.status === 'fulfilled') {
          setChannels(channelResult.value.channels)
          setChannelId(channelResult.value.channels[0]?.id ?? '')
        } else {
          toast.apiError('Could not load Slack channels', channelResult.reason)
        }
        if (selfMapping.status === 'fulfilled') {
          setDmRecipient(selfMapping.value)
        } else {
          toast.apiError('Could not load your Slack identity', selfMapping.reason)
        }
      } catch (err) {
        if (!active) return
        if (isSlackUnconfigured(err)) {
          setSlackConnected(false)

          return
        }
        toast.apiError('Could not load Slack connection', err)
      } finally {
        if (active) setLoadingSlack(false)
      }
    })()

    return () => {
      active = false
    }
  }, [subjectName, teamId])

  const selectedChannel = channels.find((channel) => channel.id === channelId)
  const dmAvailable = dmRecipient !== null
  const dmCopy = dmRecipient ? slackDmRecipientCopy(dmRecipient) : null
  const canContinue =
    (!group || groupName.trim().length > 0) &&
    (destination === 'nuphos' ||
      (destination === 'slack_dm' && dmAvailable) ||
      (destination === 'slack_channel' && selectedChannel !== undefined))

  const submit = () => {
    if (destination === 'nuphos') {
      onContinue({ type: 'nuphos' }, groupName.trim() || undefined)
    } else if (destination === 'slack_dm' && dmAvailable) {
      onContinue({ type: 'slack_dm' }, groupName.trim() || undefined)
    } else if (destination === 'slack_channel' && selectedChannel) {
      onContinue(
        {
          type: 'slack_channel',
          channelId: selectedChannel.id,
          channelName: selectedChannel.name,
        },
        groupName.trim() || undefined,
      )
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[1000] bg-black/40 backdrop-blur-sm opacity-100 transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-[1001] w-[460px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-zGray-800 bg-zGray-900 shadow-2xl shadow-black/50 outline-none transition-[opacity,transform] duration-150 data-[ending-style]:-translate-y-[48%] data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:-translate-y-[48%] data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
          <div className="flex items-start justify-between border-b border-zGray-800 px-5 py-4">
            <div className="min-w-0 pr-4">
              <Dialog.Title className="text-[14px] font-semibold text-main">
                Where should Nuphos report?
              </Dialog.Title>
              <Dialog.Description className="mt-1 truncate text-[12px] text-secondary">
                {group
                  ? `Nuphos will manage ${String(group.memberCount)} Watches together.`
                  : `Nuphos will investigate ${subjectName} when it fires.`}
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-tertiary hover:bg-zGray-800 hover:text-main"
              aria-label="Close"
            >
              <FontAwesomeIcon icon={faXmark} className="h-3.5 w-3.5" />
            </Dialog.Close>
          </div>

          {group && (
            <div className="border-b border-zGray-800 px-5 py-3.5">
              <label className="block text-[11.5px] font-medium text-secondary">
                Group name
                <input
                  type="text"
                  value={groupName}
                  onChange={(event) => setGroupName(event.target.value)}
                  maxLength={100}
                  autoFocus
                  className="mt-1.5 h-8 w-full rounded-md border border-zGray-700 bg-field px-2.5 text-[12px] text-main placeholder:text-tertiary focus:border-zViolet-accent focus:outline-none"
                />
              </label>
              <p className="mt-2 text-[11px] text-tertiary">
                Nuphos shares one ingress per provider connection and keeps each member incident
                separate.
              </p>
            </div>
          )}

          <RadioGroup
            value={destination}
            onValueChange={setDestination}
            className="space-y-2 px-5 py-4"
            aria-label="Watch destination"
          >
            <WatchDestinationCard
              value="nuphos"
              selected={destination === 'nuphos'}
              icon={<FontAwesomeIcon icon={faInbox} className="h-4 w-4" />}
              title="Nuphos"
              description="Investigate and keep the findings in Nuphos."
            />
            <WatchDestinationCard
              value="slack_dm"
              selected={destination === 'slack_dm'}
              disabled={!dmAvailable}
              icon={<FontAwesomeIcon icon={faUser} className="h-4 w-4" />}
              title={dmCopy?.title ?? 'Slack DM'}
              description={
                loadingSlack
                  ? 'Checking your Slack connection…'
                  : !slackConnected
                    ? 'Connect Slack in Settings to enable private notifications.'
                    : channelGrantOnly
                      ? "Slack DMs need this team's own Slack connection."
                      : !dmAvailable
                        ? 'Link your Slack identity in Settings → Slack first.'
                        : dmCopy!.description
              }
            />
            <WatchDestinationCard
              value="slack_channel"
              selected={destination === 'slack_channel'}
              disabled={channels.length === 0}
              icon={<FontAwesomeIcon icon={faSlack} className="h-4 w-4" />}
              title="Slack channel"
              description={
                loadingSlack
                  ? 'Loading channels Nuphos can post to…'
                  : !slackConnected
                    ? 'Connect Slack in Settings to enable channel notifications.'
                    : channels.length === 0
                      ? 'Invite the Nuphos bot to a channel first.'
                      : 'Investigate and post a replyable incident message.'
              }
            />

            {destination === 'slack_channel' && channels.length > 0 && (
              <div className="ml-10 pt-1">
                <AppSelect
                  value={channelId}
                  onValueChange={setChannelId}
                  options={channels.map((channel) => ({
                    value: channel.id,
                    label: `#${channel.name}`,
                    description: channel.isPrivate ? 'Private channel' : undefined,
                  }))}
                  ariaLabel="Slack channel"
                  triggerClassName="h-8 text-[12px]"
                  positionerClassName="!z-[1100]"
                />
              </div>
            )}
          </RadioGroup>

          <div className="flex items-center justify-end gap-2 border-t border-zGray-800 px-5 py-3.5">
            <Dialog.Close className="h-8 rounded-md px-3 text-[12px] text-secondary hover:bg-zGray-800 hover:text-main">
              Cancel
            </Dialog.Close>
            <button
              type="button"
              disabled={!canContinue}
              onClick={submit}
              className="h-8 rounded-md bg-zViolet-accent px-3 text-[12px] font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Continue in Agent
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
