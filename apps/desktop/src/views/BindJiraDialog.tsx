import {
  faArrowUpRightFromSquare,
  faDiagramProject,
  faSpinner,
} from '@fortawesome/free-solid-svg-icons'
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
}

type Phase = 'idle' | 'waiting'

export function BindJiraDialog({ open, teamId, onClose, onBound }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const attemptRef = useRef(0)

  // Single teardown path for every way the dialog can close — the Close/Cancel
  // button (which calls onClose → open=false) or the parent flipping `open` to
  // false directly. If an OAuth attempt is still in flight, invalidate it (so a
  // late-resolving startJiraOAuth is ignored) and tear down the pending grant
  // server-side so the authorize URL left open in the browser can't complete
  // into a ghost binding.
  useEffect(() => {
    if (open || phase !== 'waiting') return
    attemptRef.current += 1
    void api.atlasCancelJiraOAuth(teamId).catch(() => {})
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
      await api.atlasStartJiraOAuth(teamId)
      if (attempt !== attemptRef.current) return
      // Reset before closing so the close effect doesn't see a 'waiting' phase
      // and cancel the grant we just successfully completed.
      setPhase('idle')
      onBound()
      onClose()
    } catch (e) {
      if (attempt !== attemptRef.current) return
      setPhase('idle')
      toast.apiError('Could not connect Jira', e)
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Connect Jira"
      description="Authorize Nuphos to read and create issues in your Jira site so the agent can open, comment on, and transition tickets."
      width={460}
    >
      <div className="px-5 py-5 selectable">
        {phase === 'idle' && (
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-zGray-850 flex items-center justify-center">
              <FontAwesomeIcon icon={faDiagramProject} className="w-[22px] h-[22px] text-main" />
            </div>
            <div className="text-[12.5px] text-secondary leading-relaxed text-center max-w-[400px]">
              Click below to open Atlassian in your browser. Approve the OAuth request and you'll be
              redirected back automatically.
            </div>
          </div>
        )}

        {phase === 'waiting' && (
          <div className="flex flex-col items-center gap-4 py-3">
            <FontAwesomeIcon
              icon={faSpinner}
              className="w-6 h-6 text-zViolet-accent animate-spin"
            />
            <div className="text-[12.5px] text-secondary text-center">
              Waiting for Jira… complete the authorization in your browser.
            </div>
            <div className="text-[11px] text-tertiary text-center max-w-[380px]">
              If nothing happens, make sure your browser allowed the popup and that your OS routes{' '}
              <span className="font-mono">nuphos://</span> URLs to this app.
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-zGray-800 bg-zGray-900/60">
        <button
          onClick={close}
          className="h-8 px-3 rounded-md text-[12.5px] text-secondary hover:text-main hover:bg-zGray-800"
        >
          {phase === 'waiting' ? 'Cancel' : 'Close'}
        </button>
        {phase !== 'waiting' && (
          <button
            onClick={() => void startInstall()}
            className="h-8 px-3 rounded-md bg-zViolet-500 hover:bg-zViolet-400 text-white text-[12.5px] font-medium flex items-center gap-1.5"
          >
            <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="w-3.5 h-3.5" />
            Authorize Jira
          </button>
        )}
      </div>
    </Modal>
  )
}
