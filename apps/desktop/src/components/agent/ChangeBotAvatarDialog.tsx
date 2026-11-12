import { Loader2 } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { t } from '../../i18n'
import { agentAvatarPick, pickAgentAvatar } from '../../lib/agentAvatarChoices'
import { botAvatarFile, botAvatarName } from '../../lib/botAvatars'
import { closeChangeBotAvatar, useChangeBotAvatarRequest } from '../../lib/changeBotAvatar'
import { Modal } from '../Modal'
import { Button } from '../ui/button'
import { toast } from '../ui/toast'

import { AgentAvatarGrid } from './AgentAvatarGrid'
import { BotAvatarImage } from './BotAvatarImage'

import type { BotAvatarFile } from '../../lib/botAvatars'
import type { ChangeBotAvatarRequest } from '../../lib/changeBotAvatar'

/** Mounted once: the face picker `openChangeBotAvatar` asks for. */
export function ChangeBotAvatarHost() {
  const request = useChangeBotAvatarRequest()

  return request ? <ChangeBotAvatarDialog key={request.botId} request={request} /> : null
}

/** A Bot's face, picked again from the grid "+ New Bot" offers. */
function ChangeBotAvatarDialog({
  request: { teamId, botId, title },
}: {
  request: ChangeBotAvatarRequest
}) {
  const [current] = useState(() => botAvatarFile(botId, agentAvatarPick(botId)))
  const [picked, setPicked] = useState<BotAvatarFile>(current)
  const [preview, setPreview] = useState<BotAvatarFile | null>(null)
  const [busy, setBusy] = useState(false)
  const shown = preview ?? picked

  async function save() {
    if (busy) return
    if (picked === current) {
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
      onClose={closeChangeBotAvatar}
    >
      <form
        className="titlebar-no-drag flex flex-col gap-3 px-5 pt-1 pb-5"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <div className="flex items-center gap-3">
          <BotAvatarImage file={shown} className="size-10 shrink-0 object-contain" />
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
        <AgentAvatarGrid value={picked} onChange={setPicked} onPreview={setPreview} />
      </form>
    </Modal>
  )
}
