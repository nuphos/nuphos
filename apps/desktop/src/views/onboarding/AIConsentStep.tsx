import { useState } from 'react'

import { api } from '../../api'
import { requestAddAccount } from '../../app/accounts'
import { Button } from '../../components/ui/button'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../components/ui/menu'
import { t } from '../../i18n'

const PRIVACY = 'https://nuphos.ai/privacy'

/**
 * The AI data sharing notice, as iOS shows it before anything can reach an
 * agent: what is sent, to whom, and that it can be declined. Declining leaves
 * only account actions; the app stays on this screen until it is accepted.
 */
export function AIConsentStep({
  onAccepted,
  onLogout,
}: {
  onAccepted: () => void
  onLogout?: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const agree = async () => {
    setBusy(true)
    setError(null)
    try {
      if ((await api.authSetAIConsent(true)).accepted) onAccepted()
      else setError(t('Please update Nuphos to read the latest AI notice.'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const heading = 'pt-1 text-[13px] font-semibold text-primary'

  return (
    <div className="mx-auto flex w-full max-w-[520px] flex-col gap-3 text-[13px] leading-5 text-secondary">
      <img src="/nuphos-icon.png" alt="" className="size-11 rounded-[10px]" />
      <h1 className="pb-0.5 text-[20px] font-semibold text-primary">
        {t('Before you use AI agents')}
      </h1>
      <p>
        {t(
          'Using an agent sends your prompts, conversation history, uploaded images and files, and relevant results from connected tools to the providers needed to carry out your request.',
        )}
      </p>
      <h2 className={heading}>{t('Who receives this data')}</h2>
      <p>
        {t(
          'Depending on your runtime and model, this includes Anthropic (Claude), OpenAI (Codex), xAI (Grok), Google (Antigravity), DeepSeek (DeepSeek Harness), the model provider an OpenCode runtime uses (OpenCode Zen when it is not signed in to one), or Amazon Web Services. When tracing is enabled, Nuphos stores AI execution traces, which can include conversation and tool content, for diagnostics and service improvement.',
        )}
      </p>
      <h2 className={heading}>{t('Your choice')}</h2>
      <p>
        {t(
          'Only share information you are authorized to share. You can decline and still manage your account or request its deletion. You can withdraw permission in Account → AI data sharing. Withdrawal stops new AI use from this app; it does not undo completed transfers or stop work already running, including work started on other devices or by scheduled agents.',
        )}
      </p>
      <button
        type="button"
        onClick={() => void api.appOpenExternal(PRIVACY)}
        className="self-start font-medium text-primary underline-offset-2 hover:underline"
      >
        {t('Read the privacy policy')}
      </button>
      {error && <p className="text-attention">{error}</p>}
      <div className="flex flex-col items-center gap-1 pt-4">
        <Button className="w-full" disabled={busy} onClick={() => void agree()}>
          {t('Agree and continue')}
        </Button>
        <Menu>
          <MenuTrigger
            disabled={busy}
            className="min-h-9 px-2 text-[13px] font-medium text-tertiary hover:text-secondary"
          >
            {t('Not now — manage my account')}
          </MenuTrigger>
          <MenuContent align="center" className="min-w-52">
            <MenuItem onClick={() => requestAddAccount({ switching: true })}>
              {t('Switch account')}
            </MenuItem>
            {onLogout && <MenuItem onClick={onLogout}>{t('Log out')}</MenuItem>}
          </MenuContent>
        </Menu>
      </div>
    </div>
  )
}
