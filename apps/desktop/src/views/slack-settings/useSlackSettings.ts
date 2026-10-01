import { useEffect, useMemo, useState } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { useResetOnKey } from '../useResetOnKey'

import type {
  SlackChannelMapping,
  SlackChannelOption,
  SlackConnectionStatus,
  SlackInstallation,
  SlackUserMapping,
  TeamMember,
} from '../../types'
import type { FormEvent } from 'react'

function normalizeSlackId(value: string): string {
  return value.trim().toUpperCase()
}

function isSlackId(value: string): boolean {
  return /^[A-Z0-9]+$/.test(value)
}

export function useSlackSettings(teamId: string | undefined, currentUserId: string) {
  const [installation, setInstallation] = useState<SlackInstallation | null>(null)
  const [channelMappings, setChannelMappings] = useState<SlackChannelMapping[]>([])
  const [userMappings, setUserMappings] = useState<SlackUserMapping[]>([])
  const [myMapping, setMyMapping] = useState<SlackUserMapping | null>(null)
  const [status, setStatus] = useState<SlackConnectionStatus | null>(null)
  const [slackChannels, setSlackChannels] = useState<SlackChannelOption[]>([])
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [installOpen, setInstallOpen] = useState(false)
  const [oauthAvailable, setOauthAvailable] = useState(false)

  const [linkChannelOpen, setLinkChannelOpen] = useState(false)
  const [newChannelWorkspaceId, setNewChannelWorkspaceId] = useState('')
  const [newChannelId, setNewChannelId] = useState('')
  const [linkChannelSubmitting, setLinkChannelSubmitting] = useState(false)

  const canManage = useMemo(
    () => members.find((member) => member.id === currentUserId)?.role === 'ADMINISTRATOR',
    [members, currentUserId],
  )

  const memberById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members])

  const channelsById = useMemo(
    () => new Map(slackChannels.map((channel) => [channel.id, channel])),
    [slackChannels],
  )

  // Admins see every linked account; other members see their own row only
  // (the list endpoint is admin-gated).
  const linkedAccountRows = useMemo(
    () => (userMappings.length > 0 ? userMappings : myMapping ? [myMapping] : []),
    [userMappings, myMapping],
  )

  const defaultWorkspaceId = useMemo(() => {
    if (installation?.slackTeamId) return installation.slackTeamId
    // Skip the status workspace id when it reflects the shared fallback bot —
    // prefilling with the global bot's Slack team id would be misleading for
    // unbound workspaces and could result in a mis-linked account.
    if (status?.slackWorkspaceId && !status?.legacyGlobal) return status.slackWorkspaceId
    if (channelMappings.length > 0) return channelMappings[0].slackWorkspaceId

    return ''
  }, [installation, status, channelMappings])

  // Chained off the first request rather than written as a flat `await`
  // sequence: this is what the mount effect kicks off, and nothing it does may
  // land in the same tick as that effect.
  function refresh(): Promise<void> {
    if (!teamId) return Promise.resolve()

    return api
      .atlasListTeamMembers(teamId)
      .then(async (teamMembers) => {
        setMembers(teamMembers)
        const isAdmin =
          teamMembers.find((member) => member.id === currentUserId)?.role === 'ADMINISTRATOR'

        const [installInfo, connectionStatus, channels, mySlackMapping] = await Promise.all([
          api.atlasGetSlackInstallation(teamId),
          api.atlasGetSlackConnectionStatus(teamId),
          api.atlasListSlackChannelMappings(teamId),
          api.atlasGetMySlackUserMapping(teamId),
        ])

        setInstallation(installInfo.installation)
        setOauthAvailable(installInfo.oauthAvailable)
        setStatus(connectionStatus)
        if (connectionStatus.error) {
          toast.error('Slack connection check failed', connectionStatus.error)
        }
        setChannelMappings(channels)
        setMyMapping(mySlackMapping)

        if (isAdmin) {
          setUserMappings(await api.atlasListSlackUserMappings(teamId))
          if (connectionStatus.connected && !connectionStatus.legacyGlobal) {
            try {
              const channelList = await api.atlasListSlackChannels(teamId)

              setSlackChannels(channelList.channels ?? [])
            } catch {
              setSlackChannels([])
            }
          } else {
            setSlackChannels([])
          }
        } else {
          setUserMappings([])
          setSlackChannels([])
        }
      })
      .catch((err: unknown) => {
        toast.apiError('Could not load Slack settings', err)
      })
      .finally(() => {
        setLoading(false)
      })
  }

  // Raising the spinner is what callers of `load` want up front; the team-switch
  // path raises it from the render that switches instead.
  async function load() {
    if (!teamId) return
    setLoading(true)
    await refresh()
  }

  useResetOnKey(teamId ?? '', () => {
    if (teamId) setLoading(true)
  })
  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId])

  // Clear carried-over inputs when switching teams so a stale workspace id
  // from the previous team is never submitted.
  useResetOnKey(teamId ?? '', () => {
    setNewChannelWorkspaceId('')
    setNewChannelId('')
    setLinkChannelOpen(false)
  })

  useResetOnKey(`${newChannelWorkspaceId}|${defaultWorkspaceId}`, () => {
    if (!newChannelWorkspaceId && defaultWorkspaceId) {
      setNewChannelWorkspaceId(defaultWorkspaceId)
    }
  })

  async function submitLinkChannel(e: FormEvent) {
    e.preventDefault()
    if (!teamId || linkChannelSubmitting) return
    const workspace = normalizeSlackId(newChannelWorkspaceId)
    const channel = normalizeSlackId(newChannelId)

    if (!isSlackId(workspace) || !isSlackId(channel)) {
      toast.error('Invalid Slack ID', 'Workspace and channel IDs must look like T01ABC / C01ABC.')

      return
    }
    setLinkChannelSubmitting(true)
    try {
      await api.atlasUpsertSlackChannelMapping(teamId, {
        slackWorkspaceId: workspace,
        slackChannelId: channel,
      })
      setNewChannelId('')
      setLinkChannelOpen(false)
      await load()
      toast.success('Channel linked')
    } catch (err) {
      toast.apiError('Could not link channel', err)
    } finally {
      setLinkChannelSubmitting(false)
    }
  }

  async function deleteChannel(mapping: SlackChannelMapping) {
    if (!teamId) return
    const key = `channel:${mapping.id}`

    setBusyKey(key)
    try {
      await api.atlasDeleteSlackChannelMapping(
        teamId,
        mapping.slackWorkspaceId,
        mapping.slackChannelId,
      )
      await load()
    } catch (err) {
      toast.apiError('Could not remove channel mapping', err)
    } finally {
      setBusyKey(null)
    }
  }

  return {
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
  }
}
