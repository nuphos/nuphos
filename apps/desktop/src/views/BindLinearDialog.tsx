import {
  ExternalLink as ExternalLinkIcon,
  Workflow as WorkflowIcon,
  LoaderCircle as LoaderCircleIcon,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { api } from '../api'
import { Modal } from '../components/Modal'
import { Button } from '../components/ui/button'
import { toast } from '../components/ui/toast'
import { UiIcon } from '../components/ui/ui-icon'
import { t } from '../i18n'
import { shareFromAllowList } from '../lib/bindingShare'

import { BindShareField } from './bind-account/share-field'
import { Fill } from './bind-account/shared'
import { useResetOnKey } from './useResetOnKey'

type Props = {
  open: boolean
  teamId: string
  onClose: () => void
  onBound: () => void
}

type Phase = 'idle' | 'waiting'

export function BindLinearDialog({ open, teamId, onClose, onBound }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [shareList, setShareList] = useState<string[] | null>(null)
  const attemptRef = useRef(0)

  // Single teardown path for every way the dialog can close — the Close/Cancel
  // button (which calls onClose → open=false) or the parent flipping `open` to
  // false directly. If an OAuth attempt is still in flight, invalidate it (so a
  // late-resolving startLinearOAuth is ignored) and tear down the pending grant
  // server-side so the authorize URL left open in the browser can't complete
  // into a ghost binding.
  useEffect(() => {
    if (open || phase !== 'waiting') return
    attemptRef.current += 1
    void api.atlasCancelLinearOAuth(teamId).catch(() => {})
  }, [open, phase, teamId])

  // Reset on open, not on close: the teardown above still has to see the
  // 'waiting' phase it keys off, and the closed dialog is already fading out.
  useResetOnKey(String(open), () => {
    if (open) {
      setPhase('idle')
      setShareList(null)
    }
  })

  function close() {
    onClose()
  }

  async function startInstall() {
    const attempt = ++attemptRef.current

    setPhase('waiting')
    try {
      await api.atlasStartLinearOAuth(teamId, shareList ? shareFromAllowList(shareList) : undefined)
      if (attempt !== attemptRef.current) return
      // Reset before closing so the close effect doesn't see a 'waiting' phase
      // and cancel the grant we just successfully completed.
      setPhase('idle')
      onBound()
      onClose()
    } catch (e) {
      if (attempt !== attemptRef.current) return
      setPhase('idle')
      toast.apiError(t('Could not connect {name}', { name: 'Linear' }), e)
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={t('Connect {name}', { name: 'Linear' })}
      description={t(
        'Authorize Nuphos to read and create issues in your Linear workspace so it can open and close tickets.',
      )}
      width={460}
    >
      <div className="px-5 py-5 selectable">
        {phase === 'idle' && (
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-surface-sunken flex items-center justify-center">
              <UiIcon size={14} icon={WorkflowIcon} className="w-[22px] h-[22px] text-main" />
            </div>
            <div className="text-[12.5px] text-secondary leading-relaxed text-center max-w-[400px]">
              {t(
                "Click below to open {name} in your browser. Approve the OAuth request and you'll be redirected back automatically.",
                { name: 'Linear' },
              )}
            </div>
          </div>
        )}

        {phase === 'idle' && (
          <BindShareField
            teamId={teamId}
            provider="linear"
            value={shareList}
            onChange={setShareList}
          />
        )}

        {phase === 'waiting' && (
          <div className="flex flex-col items-center gap-4 py-3">
            <UiIcon
              size={20}
              icon={LoaderCircleIcon}
              className="w-5 h-5 text-primary animate-spin"
            />
            <div className="text-[12.5px] text-secondary text-center">
              {t('Waiting for {name}… complete the authorization in your browser.', {
                name: 'Linear',
              })}
            </div>
            <div className="text-[11px] text-tertiary text-center max-w-[380px]">
              <Fill
                text={t(
                  'If nothing happens, make sure your browser allowed the popup and that your OS routes {scheme} URLs to this app.',
                )}
                scheme={<span className="font-mono">nuphos://</span>}
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-line-control bg-state-selected">
        <button
          onClick={close}
          className="h-8 px-3 rounded-md text-[12.5px] text-secondary hover:text-main hover:bg-state-hover"
        >
          {phase === 'waiting' ? t('Cancel') : t('Close')}
        </button>
        {phase !== 'waiting' && (
          <Button size="sm" onClick={() => void startInstall()}>
            <UiIcon size={16} icon={ExternalLinkIcon} className="w-4 h-4" />
            {t('Authorize {name}', { name: 'Linear' })}
          </Button>
        )}
      </div>
    </Modal>
  )
}
