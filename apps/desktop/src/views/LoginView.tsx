import { faGoogle } from '@fortawesome/free-brands-svg-icons'
import { faArrowRight } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useState } from 'react'

import { api } from '../api'
import { NuphosLogo } from '../components/NuphosLogo'
import { Button } from '../components/ui/button'
import { toast } from '../components/ui/toast'
import { signInEmailError } from '../lib/emailDomain'

import type { UserInfo } from '../types'

type Props = {
  onLogin: (user: UserInfo) => void
}

const inputClasses =
  'w-full px-3 py-2 rounded-md bg-field border border-zGray-800 text-main text-[14px] ' +
  'outline-none focus:border-zViolet-accent placeholder:text-secondary titlebar-no-drag'

export function LoginView({ onLogin }: Props) {
  const [step, setStep] = useState<'start' | 'code'>('start')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  // No in-flight guard: each click re-launches the auth flow so the user can
  // retry freely (e.g. after closing the browser window without finishing).
  async function handleGoogleLogin() {
    try {
      const user = await api.authLogin()

      onLogin(user)
    } catch (e) {
      toast.apiError('Sign-in failed', e, {
        fallback: 'Check your internet connection and try again.',
      })
    }
  }

  async function handleSendCode() {
    if (!email.trim() || busy) return
    const emailError = signInEmailError(email.trim())

    if (emailError) {
      toast.error('Invalid email', emailError)

      return
    }
    setBusy(true)
    try {
      await api.authEmailRequestCode(email.trim())
      setCode('')
      setStep('code')
    } catch (e) {
      toast.apiError('Failed to send code', e, {
        fallback: 'Check your internet connection and try again.',
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleVerifyCode() {
    if (code.length !== 6 || busy) return
    setBusy(true)
    try {
      const user = await api.authEmailVerifyCode(email.trim(), code)

      onLogin(user)
    } catch (e) {
      toast.apiError('Sign-in failed', e, {
        fallback: 'Check your internet connection and try again.',
      })
      setBusy(false)
    }
  }

  return (
    <div className="titlebar-drag h-full flex flex-col login-surface">
      <div className="h-[44px] flex-shrink-0" />
      <div className="flex-1 flex items-start justify-center px-8 pt-[18vh]">
        <div className="w-full max-w-[360px] flex flex-col items-start text-left">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm">
            <NuphosLogo className="h-12 w-12" variant="white-bg" />
          </div>
          <h1 className="text-[20px] font-semibold text-main mb-1.5">Welcome to Nuphos</h1>
          <p className="text-[13.5px] text-secondary leading-relaxed mb-8">
            Manage your cloud infrastructure with Agent
          </p>

          {step === 'start' ? (
            <>
              <Button
                onClick={() => void handleGoogleLogin()}
                size="lg"
                className="group w-full titlebar-no-drag"
              >
                <span className="flex flex-1 items-center gap-2">
                  <FontAwesomeIcon icon={faGoogle} />
                  Continue with Google
                </span>
                <FontAwesomeIcon
                  icon={faArrowRight}
                  className="text-[14px] transition-transform duration-200 group-hover:translate-x-1"
                />
              </Button>

              <div className="w-full flex items-center gap-3 my-5">
                <div className="h-px flex-1 bg-zGray-800" />
                <span className="text-[12px] text-secondary">or</span>
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
                  className={inputClasses}
                />
                <p className="text-[12px] leading-relaxed text-tertiary">
                  Personal and work emails are welcome.
                </p>
                <Button
                  type="submit"
                  variant="secondary"
                  size="lg"
                  disabled={!email.trim() || busy}
                  className="w-full titlebar-no-drag"
                >
                  {busy ? 'Sending code…' : 'Continue with email'}
                </Button>
              </form>
            </>
          ) : (
            <form
              className="w-full flex flex-col gap-2.5"
              onSubmit={(e) => {
                e.preventDefault()
                void handleVerifyCode()
              }}
            >
              <p className="text-[13.5px] text-secondary leading-relaxed">
                Enter the 6-digit code sent to{' '}
                <span className="text-main font-medium">{email.trim()}</span>
              </p>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                className={`${inputClasses} text-center text-[18px] tracking-[8px] font-mono`}
              />
              <Button
                type="submit"
                size="lg"
                disabled={code.length !== 6 || busy}
                className="w-full titlebar-no-drag"
              >
                {busy ? 'Verifying…' : 'Verify code'}
              </Button>
              <div className="flex items-center justify-between mt-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setStep('start')}
                  className="titlebar-no-drag"
                >
                  Use a different email
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void handleSendCode()}
                  className="titlebar-no-drag"
                >
                  Resend code
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
