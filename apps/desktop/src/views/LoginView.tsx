import { useEffect, useRef, useState } from 'react'

import { api } from '../api'
import { NuphosLogo } from '../components/NuphosLogo'
import { Button } from '../components/ui/button'
import { toast } from '../components/ui/toast'
import { useErrorShake } from '../hooks/useErrorShake'
import { useStableCallback } from '../hooks/useStableCallback'
import { useTextSwap } from '../hooks/useTextSwap'
import { t } from '../i18n'
import {
  cleanCode,
  CODE_LENGTH,
  completesCode,
  hasNonDigits,
  pasteIntoCode,
  singleFlight,
} from '../lib/codeEntry'
import { signInEmailError } from '../lib/emailDomain'
import { cssDurationMs, prefersReducedMotion } from '../lib/motion'

import { LoginApiEndpoint } from './LoginApiEndpoint'
import { LoginSocialButtons } from './LoginSocialButtons'

import type { UserInfo } from '../types'

type Props = {
  onLogin: (user: UserInfo) => void
}

const inputClasses =
  'w-full px-3 py-2 rounded-md bg-surface border border-zGray-800 text-main text-[14px] ' +
  'outline-none focus:border-zViolet-accent placeholder:text-secondary titlebar-no-drag t-input'

export function LoginView({ onLogin }: Props) {
  const [step, setStep] = useState<'start' | 'code'>('start')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null)
  const { ref: emailRef, shake: shakeEmail } = useErrorShake<HTMLInputElement>()
  const {
    ref: codeRef,
    shake: shakeCode,
    clear: clearCodeError,
  } = useErrorShake<HTMLInputElement>()
  const { ref: sendLabelRef, text: sendLabelText } = useTextSwap<HTMLSpanElement>(
    busy === 'send' && step === 'start' ? t('Sending code…') : t('Continue with email'),
  )
  const { ref: verifyLabelRef, text: verifyLabelText } = useTextSwap<HTMLSpanElement>(
    busy === 'verify' ? t('Verifying…') : t('Verify code'),
  )
  const { ref: resendLabelRef, text: resendLabelText } = useTextSwap<HTMLSpanElement>(
    busy === 'send' && step === 'code' ? t('Sending…') : t('Resend code'),
  )
  const shownStep = useRef(step)
  // A different server may offer different providers.
  const [serverChanges, setServerChanges] = useState(0)

  // Both steps stay mounted for the slide, so focus the step's field once the
  // slide has settled instead of relying on autoFocus at mount.
  useEffect(() => {
    if (shownStep.current === step) return
    shownStep.current = step
    const field = step === 'code' ? codeRef : emailRef
    const timer = window.setTimeout(
      () => field.current?.focus(),
      prefersReducedMotion() ? 0 : cssDurationMs('--page-slide-dur', 250),
    )

    return () => window.clearTimeout(timer)
  }, [step, codeRef, emailRef])

  async function handleSendCode() {
    if (!email.trim() || busy) return
    const emailError = signInEmailError(email.trim())

    if (emailError) {
      shakeEmail()
      toast.error(t('Invalid email'), emailError)

      return
    }
    setBusy('send')
    try {
      await api.authEmailRequestCode(email.trim())
      setCode('')
      clearCodeError()
      setStep('code')
    } catch (e) {
      toast.apiError(t('Failed to send code'), e, {
        fallback: t('Check your internet connection and try again.'),
      })
    } finally {
      setBusy(null)
    }
  }

  async function handleVerifyCode(value: string) {
    if (value.length !== CODE_LENGTH || busy) return
    setBusy('verify')
    try {
      const user = await api.authEmailVerifyCode(email.trim(), value)

      onLogin(user)
    } catch (e) {
      toast.apiError(t('Sign-in failed'), e, {
        fallback: t('Check your internet connection and try again.'),
      })
      setBusy(null)
      shakeCode()
      codeRef.current?.select()
    }
  }

  // One verify at a time: the auto-submit and an Enter or click right after it send one request.
  const verifyLatest = useStableCallback(handleVerifyCode)
  const [verifyCode] = useState(() => singleFlight(verifyLatest))

  // The sixth digit (typed, pasted or autofilled) submits; Verify stays for a retry.
  function enterCode(next: string) {
    clearCodeError()
    setCode(next)
    if (completesCode(code, next)) void verifyCode(next)
  }

  const [codeBefore, codeAfter] = t('Enter the 6-digit code sent to {email}').split('{email}')

  return (
    <div className="titlebar-drag h-full flex flex-col login-surface">
      <div className="h-[44px] flex-shrink-0" />
      <div className="flex-1 flex items-start justify-center px-8 pt-[18vh]">
        <div className="w-full max-w-[360px] flex flex-col items-start text-left">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm">
            <NuphosLogo className="h-12 w-12" variant="white-bg" />
          </div>
          <h1 className="text-[20px] font-semibold text-main mb-1.5">{t('Welcome to Nuphos')}</h1>
          <p className="text-[13.5px] text-secondary leading-relaxed mb-8">
            {t('The agent workspace for your team')}
          </p>

          <div className="t-page-slide t-wizard-slide w-full" data-page={step === 'start' ? 1 : 2}>
            <section className="t-page" data-page-id="1" inert={step !== 'start'}>
              <LoginSocialButtons key={serverChanges} onLogin={onLogin} />

              <div className="w-full flex items-center gap-3 my-5">
                <div className="h-px flex-1 bg-zGray-800" />
                <span className="text-[12px] text-secondary">{t('or')}</span>
                <div className="h-px flex-1 bg-zGray-800" />
              </div>

              <form
                className="w-full flex flex-col gap-2.5"
                onSubmit={(e) => {
                  e.preventDefault()
                  void handleSendCode()
                }}
              >
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  ref={emailRef}
                  className={inputClasses}
                />
                <p className="text-[12px] leading-relaxed text-tertiary">
                  {t('Personal and work emails are welcome.')}
                </p>
                <Button
                  type="submit"
                  variant="secondary"
                  size="lg"
                  disabled={!email.trim() || busy !== null}
                  className="w-full titlebar-no-drag"
                >
                  <span ref={sendLabelRef} className="t-text-swap">
                    {sendLabelText}
                  </span>
                </Button>
              </form>
              <LoginApiEndpoint
                inputClassName={inputClasses}
                onChange={() => setServerChanges((n) => n + 1)}
              />
            </section>
            <section className="t-page" data-page-id="2" inert={step !== 'code'}>
              <form
                className="w-full flex flex-col gap-2.5"
                onSubmit={(e) => {
                  e.preventDefault()
                  void verifyCode(code)
                }}
              >
                <p className="text-[13.5px] text-secondary leading-relaxed">
                  {codeBefore}
                  <span className="text-main font-medium">{email.trim()}</span>
                  {codeAfter}
                </p>
                <input
                  value={code}
                  ref={codeRef}
                  onChange={(e) => enterCode(cleanCode(e.target.value))}
                  // Typed letters, spaces and symbols never go in; the cursor stays put.
                  onBeforeInput={(e) => {
                    if (hasNonDigits(e.data)) e.preventDefault()
                  }}
                  onPaste={(e) => {
                    const input = e.currentTarget
                    const pasted = pasteIntoCode(
                      code,
                      {
                        start: input.selectionStart ?? code.length,
                        end: input.selectionEnd ?? code.length,
                      },
                      e.clipboardData.getData('text'),
                    )

                    e.preventDefault()
                    enterCode(pasted.code)
                    requestAnimationFrame(() => input.setSelectionRange(pasted.caret, pasted.caret))
                  }}
                  placeholder="000000"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className={`${inputClasses} text-center text-[18px] tracking-[8px] font-mono`}
                />
                <Button
                  type="submit"
                  size="lg"
                  disabled={code.length !== CODE_LENGTH || busy !== null}
                  className="w-full titlebar-no-drag"
                >
                  <span ref={verifyLabelRef} className="t-text-swap">
                    {verifyLabelText}
                  </span>
                </Button>
                <div className="flex items-center justify-between mt-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setStep('start')}
                    className="titlebar-no-drag"
                  >
                    {t('Use a different email')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => void handleSendCode()}
                    className="titlebar-no-drag"
                  >
                    <span ref={resendLabelRef} className="t-text-swap">
                      {resendLabelText}
                    </span>
                  </Button>
                </div>
              </form>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
