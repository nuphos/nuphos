import { ExternalLink, Loader2 } from 'lucide-react'
import { Fragment } from 'react'

import { Button } from '../components/ui/button'
import { t } from '../i18n'

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
        {phaseKind === 'projects' ? t('Skip') : t('Cancel')}
      </button>
      {phaseKind === 'form' && (
        <Button size="sm" type="button" onClick={onStart} disabled={!canStart}>
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.9} />
          {startLabel}
        </Button>
      )}
      {phaseKind === 'projects' && (
        <Button size="sm" type="button" onClick={onSave} disabled={saving || !canSave}>
          {saving ? t('Saving…') : t('Save')}
        </Button>
      )}
    </div>
  )
}

export function WaitingForBrowser({ keepsGrant }: { keepsGrant: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 py-3 text-center">
      <Loader2 className="h-6 w-6 animate-spin text-zViolet-accent" />
      <div className="text-[12.5px] text-secondary">
        {t('Waiting for PostHog… complete the authorization in your browser.')}
      </div>
      <div className="text-[11.5px] text-secondary max-w-[400px]">
        {keepsGrant
          ? t(
              'The current grant stays active until PostHog approves the new one. Cancel keeps it unchanged.',
            )
          : t('Cancel stops the request; nothing is connected until PostHog approves it.')}
      </div>
      <div className="text-[11px] text-tertiary max-w-[380px]">
        {t('If nothing happens, make sure your OS routes {scheme} URLs to this app.')
          .split('{scheme}')
          .map((part, i, parts) => (
            <Fragment key={i}>
              {part}
              {i < parts.length - 1 && <span className="font-mono">nuphos://</span>}
            </Fragment>
          ))}
      </div>
    </div>
  )
}
