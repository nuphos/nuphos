import { faDiscord } from '@fortawesome/free-brands-svg-icons'
import { faArrowUpRightFromSquare, faSpinner } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useEffect, useState } from 'react'

import { api } from '../api'
import { Modal } from '../components/Modal'
import { toast } from '../components/ui/toast'

export function BindDiscordDialog({
  open,
  teamId,
  onClose,
  onBound,
}: {
  open: boolean
  teamId: string
  onClose: () => void
  onBound: () => void
}) {
  const [waiting, setWaiting] = useState(false)
  const [operation, setOperation] = useState<'install' | 'link'>('install')

  useEffect(() => {
    if (!open) return
    void api
      .atlasGetDiscordConnection(teamId)
      .then((connection) => {
        setOperation(
          connection.installation && !connection.linkedDiscordUserId ? 'link' : 'install',
        )
      })
      .catch(() => setOperation('install'))
  }, [open, teamId])

  async function install() {
    setWaiting(true)
    try {
      if (operation === 'link') await api.atlasStartDiscordLink(teamId)
      else await api.atlasStartDiscordInstall(teamId)
      onBound()
      onClose()
    } catch (err) {
      toast.apiError(
        operation === 'link' ? 'Could not link Discord account' : 'Could not install Discord bot',
        err,
      )
    } finally {
      setWaiting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={operation === 'link' ? 'Link Discord Account' : 'Install Discord Bot'}
      description={
        operation === 'link'
          ? 'Link your Discord identity so requests use your own Nuphos permissions and credentials.'
          : 'Add Nuphos to your Discord server, enable a channel with /nuphos enable and mention it to start a conversation.'
      }
      width={460}
    >
      <div className="flex flex-col items-center gap-3 px-5 py-6 selectable">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zGray-850">
          <FontAwesomeIcon icon={faDiscord} className="h-[22px] w-[22px] text-main" />
        </div>
        <p className="max-w-[390px] text-center text-[12.5px] leading-relaxed text-secondary">
          {operation === 'link'
            ? 'Discord opens in your browser to verify your identity. The bot installation and other team member links are unchanged.'
            : 'Discord opens in your browser. Choose a server and approve the bot. Your Discord account is linked to this Nuphos workspace automatically.'}
        </p>
      </div>
      <div className="flex justify-end gap-2 border-t border-zGray-800/60 px-5 py-4">
        <button
          type="button"
          onClick={onClose}
          className="h-9 rounded-md border border-zGray-800 px-3 text-[12.5px] font-medium text-secondary hover:text-main"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={waiting}
          onClick={() => void install()}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-zViolet-500 px-3 text-[12.5px] font-medium text-white disabled:opacity-60"
        >
          <FontAwesomeIcon
            icon={waiting ? faSpinner : faArrowUpRightFromSquare}
            className={waiting ? 'h-3 w-3 animate-spin' : 'h-3 w-3'}
          />
          {waiting
            ? 'Waiting for approval…'
            : operation === 'link'
              ? 'Link Discord Account'
              : 'Install Discord Bot'}
        </button>
      </div>
    </Modal>
  )
}
