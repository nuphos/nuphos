import { useRef, useState } from 'react'

import { t } from '../../../i18n'
import { AppAlertDialog } from '../../ui/alert-dialog'
import { Button } from '../../ui/button'

// Long enough for the confirm to close and hand focus back first.
const SETTLE_MS = 50

/**
 * Reset to team default and, for administrators, Set as team default, each
 * asked first as it replaces a layout, and Done. After a reset focus moves to
 * the search, as the reset button is then disabled.
 */
export function GalleryFooter({
  customized,
  isTeamAdmin,
  onReset,
  onSetTeamDefault,
  onDone,
}: {
  customized: boolean
  isTeamAdmin: boolean
  onReset: () => void
  onSetTeamDefault: () => void
  onDone: () => void
}) {
  const [confirm, setConfirm] = useState<'reset' | 'team' | null>(null)
  const footerRef = useRef<HTMLDivElement>(null)
  const focusSearch = () =>
    setTimeout(() => {
      footerRef.current?.closest('[role=dialog]')?.querySelector<HTMLElement>('input')?.focus()
    }, SETTLE_MS)

  return (
    <div
      ref={footerRef}
      className="flex shrink-0 items-center gap-1 border-t border-main px-4 py-2.5"
    >
      <Button variant="ghost" size="sm" disabled={!customized} onClick={() => setConfirm('reset')}>
        {t('Reset to team default')}
      </Button>
      {isTeamAdmin && (
        <Button variant="ghost" size="sm" onClick={() => setConfirm('team')}>
          {t('Set as team default')}
        </Button>
      )}
      <span className="flex-1" />
      <Button size="sm" onClick={onDone}>
        {t('Done')}
      </Button>
      <AppAlertDialog
        open={confirm === 'reset'}
        title={t('Reset to team default?')}
        description={t(
          'Your cards, their settings and where they sit are replaced by the team default.',
        )}
        confirmLabel={t('Reset')}
        destructive
        onConfirm={() => {
          onReset()
          focusSearch()
        }}
        onClose={() => setConfirm(null)}
      />
      <AppAlertDialog
        open={confirm === 'team'}
        title={t('Set as team default?')}
        description={t(
          'Everyone on the team who has not customized their home will see your cards, their settings and where they sit.',
        )}
        confirmLabel={t('Set as team default')}
        destructive
        onConfirm={onSetTeamDefault}
        onClose={() => setConfirm(null)}
      />
    </div>
  )
}
