import { faSlack } from '@fortawesome/free-brands-svg-icons'
import { faArrowUpRightFromSquare, faSpinner } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useEffect, useRef, useState } from 'react'

import { api } from '../api'
import { Modal } from '../components/Modal'
import { toast } from '../components/ui/toast'

import { useResetOnKey } from './useResetOnKey'

type Props = {
  open: boolean
  teamId: string
  onClose: () => void
  onBound: () => void
  // 'reinstall' re-runs the same OAuth flow against an already-connected
  // workspace to refresh the bot token and pick up newly added scopes; the
  // existing binding stays active until Slack approves the new one.
  mode?: 'install' | 'reinstall'
}

type Phase = 'idle' | 'waiting'

export function BindSlackDialog({ open, teamId, onClose, onBound, mode = 'install' }: Props) {
  const reinstall = mode === 'reinstall'
  const [phase, setPhase] = useState<Phase>('idle')
  const attemptRef = useRef(0)

  useEffect(() => {
    if (open || phase !== 'waiting') return
    attemptRef.current += 1
    void api.atlasCancelSlackOAuth(teamId).catch(() => {})
  }, [open, phase, teamId])

  // Reset on open, not on close: the teardown above still has to see the
  // 'waiting' phase it keys off, and the closed dialog is already fading out.
  useResetOnKey(String(open), () => {
    if (open) setPhase('idle')
  })

  function close() {
    onClose()
  }

  async function startInstall() {
    const attempt = ++attemptRef.current

    setPhase('waiting')
    try {
      await api.atlasStartSlackInstall(teamId)
      if (attempt !== attemptRef.current) return
      setPhase('idle')
      onBound()
      onClose()
    } catch (e) {
      if (attempt !== attemptRef.current) return
      setPhase('idle')
      toast.apiError(reinstall ? 'Could not reinstall Slack app' : 'Could not install Slack app', e)
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={reinstall ? 'Reinstall Slack App' : 'Install Slack App'}
      description={
        reinstall
          ? 'Re-approve Nuphos for your Slack workspace to refresh its permissions (e.g. newly added scopes). Existing channel and account links are kept.'
          : 'Add Nuphos to your Slack workspace. After you approve, the bot will DM you to pick channels — no IDs to copy.'
      }
      width={460}
    >
      <div className="px-5 py-5 selectable">
        {phase === 'idle' && (
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zGray-850">
              <FontAwesomeIcon icon={faSlack} className="h-[22px] w-[22px] text-main" />
            </div>
            <div className="max-w-[400px] text-center text-[12.5px] leading-relaxed text-secondary">
              {reinstall
                ? 'Click below to open Slack in your browser and re-approve the app. The connection stays active during the process; once approved, the refreshed permissions take effect immediately.'
                : 'Click below to open Slack in your browser. Approve the install and you will be redirected back automatically. The Nuphos bot will then message you in Slack to choose which channels to use.'}
            </div>
          </div>
        )}
        {phase === 'waiting' && (
          <div className="flex flex-col items-center gap-3 py-2">
            <FontAwesomeIcon icon={faSpinner} className="h-5 w-5 animate-spin text-zViolet-400" />
            <div className="text-center text-[12.5px] text-secondary">
              Waiting for Slack approval…
            </div>
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-zGray-800/60 px-5 py-4">
        <button
          type="button"
          onClick={close}
          className="h-9 rounded-md border border-zGray-800 px-3 text-[12.5px] font-medium text-secondary transition-colors hover:border-zGray-700 hover:text-main"
        >
          Cancel
        </button>
        {phase === 'idle' && (
          <button
            type="button"
            onClick={() => void startInstall()}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-zViolet-500 px-3 text-[12.5px] font-medium text-white transition-colors hover:bg-zViolet-400"
          >
            <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="h-3 w-3" />
            {reinstall ? 'Reinstall Slack App' : 'Install Slack App'}
          </button>
        )}
      </div>
    </Modal>
  )
}
