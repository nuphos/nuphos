import { ExternalLink, Loader2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '../../components/ui/combobox'
import { toast } from '../../components/ui/toast'

import { inputClasses, loginButtonClasses as buttonClass } from './styles'

import type { RuntimeLoginStep as Step } from '../../types/runtime'

type Option = Extract<Step, { kind: 'choose' }>['options'][number]

function Choose({
  step,
  value,
  onChange,
}: {
  step: Extract<Step, { kind: 'choose' }>
  value: string
  onChange: (value: string) => void
}) {
  const [query, setQuery] = useState('')
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()

    return q
      ? step.options.filter((option) => `${option.label} ${option.value}`.toLowerCase().includes(q))
      : step.options
  }, [step.options, query])

  return (
    <Combobox
      modal
      items={matches}
      filter={null}
      value={step.options.find((option) => option.value === value) ?? null}
      onInputValueChange={setQuery}
      onValueChange={(option: Option | null) => onChange(option?.value ?? '')}
      itemToStringLabel={(option: Option) => option.label}
      autoHighlight
    >
      <ComboboxInput aria-label={step.message} placeholder="Search…" className="h-10" />
      <ComboboxContent className="max-h-[340px] w-[var(--anchor-width)] p-0 [padding-block:0]">
        <ComboboxList className="max-h-[300px] overflow-auto p-0 [padding-block:0]">
          {(option: Option) => (
            <ComboboxItem key={option.value} value={option}>
              <span className="flex-1 truncate">{option.label}</span>
              {option.hint && <span className="text-xs text-tertiary">{option.hint}</span>}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

type Paste = 'code' | 'address' | 'none'

const BROWSER_PROMPT: Record<Paste, string> = {
  address:
    'Approve access on the page. Your browser then ends on a page that does not load; copy the full address from its address bar and paste it here.',
  code: 'Approve access on the page, then paste the code it shows you here.',
  none: 'Approve access on the page. The agent connects as soon as you do.',
}
const PASTE_PLACEHOLDER: Record<Paste, string> = {
  address: 'Paste the full address (starts with http://localhost)',
  code: 'Paste code',
  none: '',
}

/** What the user types or picks for a step that takes an answer. */
function Answer({ step, onSubmit }: { step: Step; onSubmit: (answer: string) => Promise<void> }) {
  const [answer, setAnswer] = useState('')
  const [sending, setSending] = useState(false)
  const secret = step.kind === 'input' && step.secret === true

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending || !answer.trim()) return
    setSending(true)
    try {
      await onSubmit(answer.trim())
    } catch (cause) {
      toast.apiError('Could not continue sign-in', cause)
    } finally {
      setSending(false)
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex items-center gap-2">
      {step.kind === 'choose' ? (
        <Choose step={step} value={answer} onChange={setAnswer} />
      ) : (
        <input
          aria-label={step.kind === 'input' ? step.message : 'Code or address'}
          className={inputClasses}
          type={secret ? 'password' : 'text'}
          value={answer}
          autoComplete="off"
          spellCheck={false}
          placeholder={
            step.kind === 'input' ? step.placeholder : PASTE_PLACEHOLDER[step.paste ?? 'none']
          }
          disabled={sending}
          onChange={(event) => setAnswer(event.target.value)}
        />
      )}
      <button
        type="submit"
        disabled={sending || !answer.trim()}
        className={`${buttonClass} shrink-0`}
      >
        {sending ? 'Sending…' : 'Continue'}
      </button>
    </form>
  )
}

/** One step of a sign-in that asks before it authorizes, as OpenCode's does. */
export function RuntimeLoginStep({
  step,
  submitted,
  onSubmit,
}: {
  step: Step
  submitted: boolean
  onSubmit: (answer: string) => Promise<void>
}) {
  if (submitted)
    return (
      <div className="flex items-center gap-3 text-[13px] text-secondary">
        <Loader2 className="h-4 w-4 animate-spin" />
        Continuing sign-in…
      </div>
    )
  if (step.kind !== 'browser')
    return (
      <>
        <p className="text-[13px] leading-5 text-secondary">{step.message}</p>
        <Answer step={step} onSubmit={onSubmit} />
        {step.kind === 'input' && step.secret && (
          <p className="text-xs leading-5 text-tertiary">
            Nuphos passes the key to the agent, which keeps it; Nuphos does not keep a copy.
          </p>
        )}
      </>
    )

  return (
    <>
      <p className="text-[13px] leading-5 text-secondary">{BROWSER_PROMPT[step.paste ?? 'none']}</p>
      {step.instructions && (
        <p className="whitespace-pre-wrap rounded-lg border border-zGray-700 bg-zGray-800/40 px-4 py-3 text-[13px] text-main select-text">
          {step.instructions}
        </p>
      )}
      {step.url && (
        <a
          href={step.url}
          target="_blank"
          rel="noopener noreferrer"
          className={`${buttonClass} w-full`}
        >
          Open {new URL(step.url).hostname} <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
      {step.paste ? (
        <Answer step={step} onSubmit={onSubmit} />
      ) : (
        <p className="flex items-center gap-2 text-[13px] text-secondary">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          Waiting for approval…
        </p>
      )}
    </>
  )
}
