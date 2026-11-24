import { faDiscord } from '@fortawesome/free-brands-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { LoaderCircle as LoaderCircleIcon, ExternalLink as ExternalLinkIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../api'
import { Modal } from '../components/Modal'
import { Button } from '../components/ui/button'
import { toast } from '../components/ui/toast'
import { UiIcon } from '../components/ui/ui-icon'
import { t } from '../i18n'

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
        operation === 'link'
          ? t('Could not link Discord account')
          : t('Could not install Discord bot'),
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
      title={operation === 'link' ? t('Link Discord Account') : t('Install Discord Bot')}
      description={
        operation === 'link'
          ? t(
              'Link your Discord identity so requests use your own Nuphos permissions and credentials.',
            )
          : t(
              'Add Nuphos to your Discord server, enable a channel with /nuphos enable and mention it to start a conversation.',
            )
      }
      width={460}
    >
      <div className="flex flex-col items-center gap-3 px-5 py-6 selectable">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-sunken">
          <FontAwesomeIcon icon={faDiscord} className="h-[22px] w-[22px] text-main" />
        </div>
        <p className="max-w-[390px] text-center text-[12.5px] leading-relaxed text-secondary">
          {operation === 'link'
            ? t(
                'Discord opens in your browser to verify your identity. The bot installation and other team member links are unchanged.',
              )
            : t(
                'Discord opens in your browser. Choose a server and approve the bot. Your Discord account is linked to this Nuphos team automatically.',
              )}
        </p>
      </div>
      <div className="flex justify-end gap-2 border-t border-line-control/60 px-5 py-4">
        <button
          type="button"
          onClick={onClose}
          className="h-9 rounded-md border border-line-control px-3 text-[12.5px] font-medium text-secondary hover:text-main"
        >
          {t('Cancel')}
        </button>
        <Button size="sm" type="button" disabled={waiting} onClick={() => void install()}>
          <UiIcon
            size={16}
            icon={waiting ? LoaderCircleIcon : ExternalLinkIcon}
            className={waiting ? 'h-4 w-4 animate-spin' : 'h-4 w-4'}
          />
          {waiting
            ? t('Waiting for approval…')
            : operation === 'link'
              ? t('Link Discord Account')
              : t('Install Discord Bot')}
        </Button>
      </div>
    </Modal>
  )
}
