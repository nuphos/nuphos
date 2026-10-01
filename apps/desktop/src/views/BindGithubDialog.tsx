import { ExternalLink, Loader2 } from 'lucide-react'
import { useRef, useState } from 'react'

import { api } from '../api'
import { GithubMark } from '../components/GithubMark'
import { Modal } from '../components/Modal'

import { useResetOnKey } from './useResetOnKey'

type Props = {
  open: boolean
  teamId: string
  onClose: () => void
  onBound: () => void
}

type Phase = { kind: 'idle' } | { kind: 'waiting' } | { kind: 'error'; message: string }

export function BindGithubDialog({ open, teamId, onClose, onBound }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  // Per-attempt token. close() / startInstall() bump it; the resolve / reject
  // path of an in-flight startInstall captures its own token at start and
  // bails out if it no longer matches — handles cancel-then-restart races
  // that a single shared "cancelled" boolean can't.
  const attemptRef = useRef(0)

  useResetOnKey(String(open), () => {
    if (!open) setPhase({ kind: 'idle' })
  })

  function close() {
    if (phase.kind === 'waiting') {
      attemptRef.current += 1
    }
    onClose()
  }

  async function startInstall() {
    const attempt = ++attemptRef.current

    setPhase({ kind: 'waiting' })
    try {
      await api.atlasStartGithubInstall(teamId)
      if (attempt !== attemptRef.current) return
      onBound()
      onClose()
    } catch (e) {
      if (attempt !== attemptRef.current) return
      setPhase({
        kind: 'error',
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Connect GitHub"
      description="Install the Nuphos GitHub App so the agent can read and act on your repositories."
      width={460}
    >
      <div className="px-5 py-5 selectable">
        {phase.kind === 'idle' && (
          <div className="flex flex-col items-center gap-4 py-2">
            <div className="w-12 h-12 rounded-full bg-zGray-850 flex items-center justify-center">
              <GithubMark size={26} className="text-main" />
            </div>
            <div className="text-[12.5px] text-secondary leading-relaxed text-center max-w-[340px]">
              Click below to open GitHub in your browser. Pick the user or organization, choose
              which repositories Nuphos should access, then return here — the dialog will close
              automatically.
            </div>
          </div>
        )}

        {phase.kind === 'waiting' && (
          <div className="flex flex-col items-center gap-4 py-3">
            <Loader2 className="w-6 h-6 text-zViolet-accent animate-spin" strokeWidth={1.8} />
            <div className="text-[12.5px] text-secondary text-center">
              Waiting for GitHub… complete the installation in your browser.
            </div>
            <div className="text-[11px] text-tertiary text-center max-w-[340px]">
              If nothing happens, make sure your browser allowed the popup, and that your OS allowed
              Nuphos to handle <span className="font-mono">nuphos://</span> URLs.
            </div>
          </div>
        )}

        {phase.kind === 'error' && (
          <div className="px-3 py-2 rounded-md bg-error/10 text-error text-[12.5px] whitespace-pre-wrap">
            {phase.message}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-zGray-800 bg-zGray-900/60">
        <button
          onClick={close}
          className="h-8 px-3 rounded-md text-[12.5px] text-secondary hover:text-main hover:bg-zGray-800"
        >
          {phase.kind === 'waiting' ? 'Cancel' : 'Close'}
        </button>
        {phase.kind !== 'waiting' && (
          <button
            onClick={() => void startInstall()}
            className="h-8 px-3 rounded-md bg-zViolet-500 hover:bg-zViolet-400 text-white text-[12.5px] font-medium flex items-center gap-1.5"
          >
            <ExternalLink className="w-3.5 h-3.5" strokeWidth={1.8} />
            {phase.kind === 'error' ? 'Try again' : 'Install GitHub App'}
          </button>
        )}
      </div>
    </Modal>
  )
}
