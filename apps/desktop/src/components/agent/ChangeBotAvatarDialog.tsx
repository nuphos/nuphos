import { Loader2 } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { t } from '../../i18n'
import { agentAvatarPick, pickAgentAvatar, receiveAgentAvatars } from '../../lib/agentAvatarChoices'
import { trustedAvatarURL } from '../../lib/avatarUrl'
import { botAvatarFile, botAvatarName } from '../../lib/botAvatars'
import { closeChangeBotAvatar, useChangeBotAvatarRequest } from '../../lib/changeBotAvatar'
import { AvatarPicker } from '../../views/settings/AvatarPicker'
import { Modal } from '../Modal'
import { Button } from '../ui/button'
import { toast } from '../ui/toast'

import { AgentAvatarGrid } from './AgentAvatarGrid'

import type { BotAvatarFile } from '../../lib/botAvatars'
import type { ChangeBotAvatarRequest } from '../../lib/changeBotAvatar'

/** Mounted once: the face picker `openChangeBotAvatar` asks for. */
export function ChangeBotAvatarHost() {
  const request = useChangeBotAvatarRequest()

  return request ? <ChangeBotAvatarDialog key={request.botId} request={request} /> : null
}

/** A Bot's face, picked again from the grid "+ New Bot" offers, or an uploaded photo. */
function ChangeBotAvatarDialog({
  request: { teamId, botId, title },
}: {
  request: ChangeBotAvatarRequest
}) {
  // A Bot wearing a photo has no character picked, so any tile is a change.
  const [photo] = useState(() => trustedAvatarURL(agentAvatarPick(botId)))
  const [current] = useState(() =>
    photo ? undefined : botAvatarFile(botId, agentAvatarPick(botId)),
  )
  const [picked, setPicked] = useState(current)
  const [preview, setPreview] = useState<BotAvatarFile | null>(null)
  const [busy, setBusy] = useState(false)
  const shown = preview ?? picked

  async function upload(image: Uint8Array) {
    const requestedAt = Date.now()
    const { avatar } = await api.agentUploadConversationAvatar(botId, image, teamId)

    receiveAgentAvatars([{ sessionId: botId, avatar }], requestedAt)
    closeChangeBotAvatar()
  }

  async function save() {
    if (busy) return
    if (!picked || picked === current) {
      closeChangeBotAvatar()

      return
    }
    setBusy(true)
    const name = botAvatarName(picked)

    try {
      // Shown everywhere at once; the old face comes back if the save fails.
      await pickAgentAvatar(botId, name, () => api.agentSetConversationAvatar(botId, name, teamId))
      closeChangeBotAvatar()
    } catch (err) {
      toast.apiError(t('Could not change avatar'), err)
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      title={t('Change avatar')}
      appearance="prompt"
      width={440}
      // The first control is the face: focused, it would open covered by "Change photo".
      focusFirstControl={false}
      onClose={closeChangeBotAvatar}
    >
      <form
        className="titlebar-no-drag flex flex-col gap-3 px-5 pt-1 pb-5"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <AvatarPicker
          src={shown ? `/bot-avatars/${shown}` : photo}
          name={title ?? ''}
          onUpload={upload}
        />
        <AgentAvatarGrid value={picked} onChange={setPicked} onPreview={setPreview} />
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-main">{title}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={closeChangeBotAvatar}
          >
            {t('Cancel')}
          </Button>
          <Button type="submit" variant="neutral" size="sm" disabled={busy}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t('Save')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
