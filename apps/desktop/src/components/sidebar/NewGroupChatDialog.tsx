import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../api'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { t } from '../../i18n'
import { addableAgents } from '../agent/channelPeople'
import { TeammatePicker } from '../agent/TeammatePicker'
import { markChannel } from '../channels/channelKind'
import { Modal } from '../Modal'
import { Button } from '../ui/button'
import { toast } from '../ui/toast'

import type { Pickable } from '../agent/PersonFace'

/**
 * "New Group Chat": a name and who is in it, and nothing exists until Create.
 * An empty name leaves the chat called by its members, as the backend names it.
 */
export function NewGroupChatDialog({
  teamId,
  onClose,
  onCreated,
}: {
  teamId: string
  onClose: () => void
  onCreated: (sessionId: string) => void
}) {
  const viewerId = useCurrentUser()?.id ?? ''
  const [name, setName] = useState('')
  const [members, setMembers] = useState<Pickable[] | null>(null)
  const [picked, setPicked] = useState<Pickable[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api
      .atlasListTeamMembers(teamId)
      .then(setMembers)
      .catch((err: unknown) => toast.apiError(t('Failed to load team members'), err))
  }, [teamId])

  // The viewer is in every chat they make; their own Bots may join it too.
  const invitable = [
    ...(members ?? []).filter((member) => member.id !== viewerId),
    ...addableAgents(teamId, viewerId, []),
  ]

  const toggle = (member: Pickable) =>
    setPicked((current) =>
      current.some((m) => m.id === member.id)
        ? current.filter((m) => m.id !== member.id)
        : [...current, member],
    )

  async function create() {
    setBusy(true)
    try {
      const { sessionId } = await api.agentCreateChannel(teamId, true, name.trim())
      const people = picked.filter((member) => !member.agent).map((member) => member.id)

      markChannel(sessionId)
      // The chat exists now: a member who fails to join is added later from Share.
      await Promise.all([
        people.length > 0
          ? api.agentInviteConversationParticipants(sessionId, teamId, people, false)
          : undefined,
        ...picked
          .filter((member) => member.agent)
          .map((agent) => api.agentAddChannelAgent(sessionId, teamId, agent.id)),
      ]).catch((err: unknown) => toast.apiError(t('Failed to add teammates'), err))
      onCreated(sessionId)
    } catch (err) {
      toast.apiError(t('Could not create the group chat'), err)
      setBusy(false)
    }
  }

  return (
    <Modal open title={t('New Group Chat')} appearance="prompt" width={440} onClose={onClose}>
      <form
        className="titlebar-no-drag flex flex-col gap-3 px-5 pt-1 pb-5"
        onSubmit={(event) => {
          event.preventDefault()
          if (!busy) void create()
        }}
      >
        <input
          aria-label={t('Group chat name')}
          placeholder={t('Name (optional)')}
          autoFocus
          maxLength={200}
          value={name}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') event.stopPropagation()
            if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault()
          }}
          className="min-w-0 rounded-md border border-main bg-main px-3 py-2 text-[13px] text-main outline-none focus:border-line-focus"
        />
        <TeammatePicker
          members={members}
          invitable={invitable}
          picked={picked}
          disabled={busy}
          onToggle={toggle}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" data-cancel onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button type="submit" variant="neutral" size="sm" disabled={busy}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t('Create')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
