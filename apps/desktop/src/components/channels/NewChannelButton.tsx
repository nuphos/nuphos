import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../api'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { t } from '../../i18n'
import { TeammatePicker } from '../agent/TeammatePicker'
import { Button } from '../ui/button'
import { toast } from '../ui/toast'

import { markChannel } from './channelKind'
import { ChannelPopover } from './channelParts'
import { ownAgents } from './channelShared'

import type { Pickable } from '../agent/PersonFace'
import type { TeamMember } from '../../types'

/**
 * The sidebar's "+" for a new chat. It asks for no name: each member sees the
 * chat called by the others in it, until someone renames it.
 */
export function NewChannelButton({
  teamId,
  onCreated,
}: {
  teamId: string
  onCreated: (sessionId: string) => void
}) {
  const viewer = useCurrentUser()
  const viewerId = viewer?.id ?? ''
  const [open, setOpen] = useState(false)
  const [members, setMembers] = useState<TeamMember[] | null>(null)
  // Teammates and the viewer's own agents are picked alike: an agent is a teammate here.
  const [picked, setPicked] = useState<Pickable[]>([])
  const [busy, setBusy] = useState(false)
  const agents: Pickable[] = (open ? ownAgents(teamId, viewerId) : []).map((agent) => ({
    id: agent.sessionId,
    name: agent.title || t('Untitled agent'),
    email: '',
    agent: { avatar: agent.avatar, provider: agent.agentRuntime },
  }))

  useEffect(() => {
    if (!open || members) return
    api.atlasListTeamMembers(teamId).then(setMembers, () => setMembers([]))
  }, [open, members, teamId])

  const create = async () => {
    setBusy(true)
    try {
      const { sessionId } = await api.agentCreateChannel(teamId)

      markChannel(sessionId)
      const people = picked.filter((member) => !member.agent)

      if (people.length > 0)
        await api.agentInviteConversationParticipants(
          sessionId,
          teamId,
          people.map((person) => person.id),
        )
      for (const agent of picked.filter((member) => member.agent))
        await api.agentAddChannelAgent(sessionId, teamId, agent.id)
      setOpen(false)
      setPicked([])
      onCreated(sessionId)
    } catch (error) {
      toast.apiError(t('Could not create the chat'), error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ChannelPopover
      open={open}
      onOpenChange={setOpen}
      align="start"
      nativeButton={false}
      title={t('New chat')}
      trigger={
        <span
          role="button"
          tabIndex={0}
          aria-label={t('New chat')}
          title={t('New chat')}
          onPointerDown={(event) => event.stopPropagation()}
          className="ml-auto inline-flex h-5 w-5 items-center justify-center rounded text-tertiary hover:bg-[var(--sidebar-overlay-hover)] hover:text-secondary"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
        </span>
      }
    >
      <TeammatePicker
        members={members}
        invitable={[...(members ?? []).filter((member) => member.id !== viewerId), ...agents]}
        picked={picked}
        disabled={busy}
        onToggle={(member) =>
          setPicked((current) =>
            current.some((p) => p.id === member.id)
              ? current.filter((p) => p.id !== member.id)
              : [...current, member],
          )
        }
      />
      <Button
        variant="neutral"
        size="sm"
        disabled={busy || picked.length === 0}
        onClick={() => void create()}
      >
        {t('Create chat')}
      </Button>
    </ChannelPopover>
  )
}
