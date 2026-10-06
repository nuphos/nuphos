import { ExternalLink, Loader2 } from 'lucide-react'
import { useState } from 'react'

import { toast } from '../../components/ui/toast'
import { AGENT_PROVIDER } from '../../types/runtime'

import { pastedSignInReady } from './runtimeLogin'
import { inputClasses, loginButtonClasses as buttonClass } from './styles'

import type { AgentProvider } from '../../types/runtime'

/**
 * A browser sign-in the runtime needs something back from: Claude's page shows a code;
 * Antigravity's Google sign-in ends on a 127.0.0.1 address that does not load.
 */
export function BrowserCodeEntry({
  provider,
  url,
  submitted,
  onSubmit,
}: {
  provider: AgentProvider
  url: string
  submitted: boolean
  onSubmit: (code: string) => Promise<void>
}) {
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const account = AGENT_PROVIDER[provider].account
  const loopback = provider === 'antigravity'

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting || !code.trim()) return
    if (!pastedSignInReady(provider, code)) {
      toast.error(
        'Paste the whole address',
        'Copy the full address your browser ended on, starting with http://127.0.0.1.',
      )

      return
    }
    setSubmitting(true)
    try {
      await onSubmit(code.trim())
    } catch (cause) {
      toast.apiError('Could not send the code', cause)
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted)
    return (
      <div className="flex items-center gap-3 text-[13px] text-secondary">
        <Loader2 className="h-4 w-4 animate-spin" />
        {loopback ? `Finishing sign-in with ${account}…` : `Checking the code with ${account}…`}
      </div>
    )

  return (
    <>
      <p className="text-[13px] leading-5 text-secondary">
        {loopback
          ? `Approve access on ${account}’s page. Your browser then ends on a page that does not load; copy the full address from its address bar and paste it here.`
          : `Approve access on ${account}’s page, then paste the code it shows you here.`}{' '}
        The agent keeps the sign-in; Nuphos does not store it.
      </p>
      <a href={url} target="_blank" rel="noopener noreferrer" className={`${buttonClass} w-full`}>
        Open {account} <ExternalLink className="h-3.5 w-3.5" />
      </a>
      <form onSubmit={(event) => void submit(event)} className="flex items-center gap-2">
        <input
          aria-label={loopback ? 'Address your browser ended on' : `Code from ${account}`}
          className={inputClasses}
          value={code}
          autoComplete="off"
          spellCheck={false}
          placeholder={
            loopback ? 'Paste the full address (starts with http://127.0.0.1)' : 'Paste code'
          }
          disabled={submitting}
          onChange={(event) => setCode(event.target.value)}
        />
        <button
          type="submit"
          disabled={submitting || !code.trim()}
          className={`${buttonClass} shrink-0`}
        >
          {submitting ? 'Sending…' : 'Continue'}
        </button>
      </form>
    </>
  )
}
