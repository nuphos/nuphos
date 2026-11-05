import { Button } from '../../components/ui/button'
import { t } from '../../i18n'

import { LocalAgentSignIn } from './LocalAgentSignIn'

/** A signed-out agent on one of the viewer's own computers, signed in from its card. */
export function LocalAgentSignInRow({
  signIn,
  cliOpen,
  onCliClosed,
  onRuntimeSignIn,
  busy,
}: {
  signIn: 'claude-code' | 'codex' | 'runtime'
  /** Its CLI sign-in is open, started from the ⋯ menu. */
  cliOpen: boolean
  onCliClosed: () => void
  onRuntimeSignIn: () => void
  busy: boolean
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
      <p className="text-xs leading-relaxed text-tertiary">{t('Not signed in.')}</p>
      {signIn === 'runtime' ? (
        <Button size="sm" disabled={busy} onClick={onRuntimeSignIn}>
          {t('Sign in')}
        </Button>
      ) : (
        // Opened from the menu, it starts open; closing it brings the button back.
        <LocalAgentSignIn
          key={String(cliOpen)}
          provider={signIn}
          initiallyOpen={cliOpen}
          onClosed={onCliClosed}
        />
      )}
    </div>
  )
}
