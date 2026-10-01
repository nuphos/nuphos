import { ExternalLink, Loader2 } from 'lucide-react'

const PRIMARY_CLASS =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zViolet-500 hover:bg-zViolet-400 text-white text-[12.5px] disabled:opacity-50'

export function DialogFooter({
  phaseKind,
  saving,
  canStart,
  canSave,
  startLabel,
  onCancel,
  onStart,
  onSave,
}: {
  phaseKind: 'form' | 'waiting' | 'projects'
  saving: boolean
  canStart: boolean
  canSave: boolean
  startLabel: string
  onCancel: () => void
  onStart: () => void
  onSave: () => void
}) {
  return (
    <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-zGray-800">
      <button
        type="button"
        onClick={onCancel}
        disabled={saving}
        className="px-3 py-1.5 rounded-md text-secondary hover:text-main text-[12.5px] disabled:opacity-50"
      >
        {phaseKind === 'projects' ? 'Skip' : 'Cancel'}
      </button>
      {phaseKind === 'form' && (
        <button type="button" onClick={onStart} disabled={!canStart} className={PRIMARY_CLASS}>
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.9} />
          {startLabel}
        </button>
      )}
      {phaseKind === 'projects' && (
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !canSave}
          className={PRIMARY_CLASS}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      )}
    </div>
  )
}

export function WaitingForBrowser({ keepsGrant }: { keepsGrant: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 py-3 text-center">
      <Loader2 className="h-6 w-6 animate-spin text-zViolet-accent" />
      <div className="text-[12.5px] text-secondary">
        Waiting for PostHog… complete the authorization in your browser.
      </div>
      <div className="text-[11.5px] text-secondary max-w-[400px]">
        {keepsGrant
          ? 'The current grant stays active until PostHog approves the new one. Cancel keeps it unchanged.'
          : 'Cancel stops the request; nothing is connected until PostHog approves it.'}
      </div>
      <div className="text-[11px] text-tertiary max-w-[380px]">
        If nothing happens, make sure your OS routes <span className="font-mono">nuphos://</span>{' '}
        URLs to this app.
      </div>
    </div>
  )
}
