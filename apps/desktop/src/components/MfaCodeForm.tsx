import { useState } from 'react'

import { useErrorShake } from '../hooks/useErrorShake'
import { useStableCallback } from '../hooks/useStableCallback'
import { t } from '../i18n'
import { CODE_LENGTH, completesCode, singleFlight } from '../lib/codeEntry'

import { CodeInput, codeInputClasses } from './CodeInput'
import { Button } from './ui/button'
import { toast } from './ui/toast'

/**
 * Asks for a code from the authenticator app, or a recovery code instead. A
 * full six-digit code submits by itself. `onSubmit` throws when the code is
 * refused; the field then shakes and the backend's reason shows in a toast.
 */
export function MfaCodeForm({
  onSubmit,
  submitLabel,
  autoFocus = true,
}: {
  onSubmit: (code: string) => Promise<void>
  submitLabel: string
  autoFocus?: boolean
}) {
  const [recovery, setRecovery] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const { ref, shake, clear } = useErrorShake<HTMLInputElement>()

  const complete = (value: string) =>
    recovery ? value.trim().length > 0 : value.length === CODE_LENGTH

  async function submit(value: string) {
    if (busy || !complete(value)) return
    setBusy(true)
    try {
      await onSubmit(value)
    } catch (e) {
      toast.apiError(t('That code didn’t work'), e, {
        fallback: t('Check your internet connection and try again.'),
      })
      shake()
      ref.current?.select()
    } finally {
      setBusy(false)
    }
  }

  // One submit at a time: the auto-submit and an Enter or click right after it send one request.
  const submitLatest = useStableCallback(submit)
  const [submitOnce] = useState(() => singleFlight(submitLatest))

  function switchMode() {
    setRecovery(!recovery)
    setCode('')
    clear()
    requestAnimationFrame(() => ref.current?.focus())
  }

  return (
    <form
      className="w-full flex flex-col gap-2.5"
      onSubmit={(e) => {
        e.preventDefault()
        void submitOnce(code)
      }}
    >
      {recovery ? (
        <input
          ref={ref}
          value={code}
          autoFocus={autoFocus}
          onChange={(e) => {
            clear()
            setCode(e.target.value)
          }}
          placeholder="xxxx-xxxx-xxxx-xxxx"
          autoComplete="off"
          spellCheck={false}
          className={`${codeInputClasses} text-center font-mono`}
        />
      ) : (
        <CodeInput
          value={code}
          inputRef={ref}
          autoFocus={autoFocus}
          onChange={(next) => {
            clear()
            setCode(next)
            if (completesCode(code, next)) void submitOnce(next)
          }}
        />
      )}
      <Button
        type="submit"
        size="lg"
        disabled={!complete(code) || busy}
        className="w-full titlebar-no-drag"
      >
        {busy ? t('Verifying…') : submitLabel}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={switchMode}
        className="self-start titlebar-no-drag"
      >
        {recovery ? t('Use your authenticator app') : t('Use a recovery code')}
      </Button>
    </form>
  )
}
