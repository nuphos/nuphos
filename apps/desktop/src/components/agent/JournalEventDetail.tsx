import { Collapsible } from '@base-ui/react/collapsible'
import { Brain, ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createHighlighter } from 'shiki'

import { journalReasoningText, parseToolOutputPreview } from '../../lib/journalEvent'

import { ClampedText } from './JournalEventChips'

import type { Highlighter } from 'shiki'

// One lazily-created highlighter for every journal code block; the same
// theme streamdown uses for chat markdown, so the two surfaces match.
let shikiPromise: Promise<Highlighter> | null = null

function getShiki(): Promise<Highlighter> {
  if (!shikiPromise) {
    shikiPromise = createHighlighter({ themes: ['night-owl'], langs: ['bash', 'json'] })
  }

  return shikiPromise
}

function HighlightedCode({ code, lang }: { code: string; lang: 'bash' | 'json' }) {
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    getShiki()
      .then((highlighter) => {
        if (cancelled) return
        setHtml(highlighter.codeToHtml(code, { lang, theme: 'night-owl' }))
      })
      .catch(() => {
        /* plain fallback stays up */
      })

    return () => {
      cancelled = true
    }
  }, [code, lang])
  if (html === null) {
    return (
      <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.45] text-main/85">
        {code}
      </pre>
    )
  }

  // Shiki output is generated locally from the journal text — no foreign HTML.
  return <div className="journal-shiki" dangerouslySetInnerHTML={{ __html: html }} />
}

/** Clamp + highlight: only the shown slice is tokenized; `more` re-highlights the rest. */
function ClampedCode({
  text,
  lang,
  limit = 400,
}: {
  text: string
  lang: 'bash' | 'json'
  limit?: number
}) {
  const [expanded, setExpanded] = useState(false)
  const clipped = !expanded && text.length > limit

  return (
    <div>
      <HighlightedCode code={clipped ? `${text.slice(0, limit)}…` : text} lang={lang} />
      {text.length > limit && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setExpanded((v) => !v)
          }}
          className="text-[10px] text-violet-300/90 hover:text-violet-200"
        >
          {expanded ? 'less' : 'more'}
        </button>
      )}
    </div>
  )
}

function looksLikeJson(text: string): boolean {
  const head = text.trimStart()

  return head.startsWith('{') || head.startsWith('[')
}

/** Transcript-style command block: `$ cmd` in a mono card, bash-highlighted. */
export function CommandCard({ command, rest }: { command: string | null; rest?: string }) {
  if (!command && !rest) return null

  return (
    <div className="overflow-hidden rounded-md border border-zGray-800 bg-zGray-925/80">
      {command && (
        <div className="flex gap-1.5 px-2.5 py-1.5 text-[11px] leading-4">
          <span className="select-none font-mono text-tertiary">$</span>
          <div className="min-w-0 flex-1">
            <ClampedCode text={command} lang="bash" limit={400} />
          </div>
        </div>
      )}
      {rest && (
        <div className="border-t border-zGray-800/60 px-2.5 py-1.5">
          {looksLikeJson(rest) ? (
            <ClampedCode text={rest} lang="json" limit={280} />
          ) : (
            <ClampedText text={rest} mono limit={280} />
          )}
        </div>
      )}
    </div>
  )
}

/** Parsed tool output: stdout/stderr like the transcript's card; raw fallback. */
export function ToolOutputBody({ payload }: { payload: Record<string, unknown> }) {
  const output = parseToolOutputPreview(payload)

  if (!output.raw) return null
  if (output.stdout === null && output.stderr === null && output.exitCode === null) {
    return looksLikeJson(output.raw) ? (
      <ClampedCode text={output.raw} lang="json" limit={280} />
    ) : (
      <ClampedText text={output.raw} mono limit={280} />
    )
  }

  return (
    <div className="space-y-1">
      {output.stdout ? (
        looksLikeJson(output.stdout) ? (
          <ClampedCode text={output.stdout} lang="json" limit={400} />
        ) : (
          <ClampedText text={output.stdout} mono limit={400} />
        )
      ) : null}
      {output.stderr ? (
        <div className="text-error/90">
          <ClampedText text={output.stderr} mono limit={280} />
        </div>
      ) : null}
      {!output.stdout && !output.stderr && (
        <div className="text-[10.5px] text-tertiary">no output</div>
      )}
    </div>
  )
}

/**
 * The model's reasoning, folded by default. It is part of the hashed
 * contentHot, so showing it costs nothing in integrity terms — and it answers
 * the forensic question "why did the agent decide to do this".
 */
export function ReasoningText({ text, label = 'Reasoning' }: { text: string; label?: string }) {
  if (!text) return null

  return (
    <Collapsible.Root>
      <Collapsible.Trigger
        onClick={(e) => e.stopPropagation()}
        className="group inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-tertiary hover:text-main/80"
      >
        <ChevronRight
          className="h-2.5 w-2.5 transition-transform group-data-[panel-open]:rotate-90"
          strokeWidth={2}
        />
        <Brain className="h-2.5 w-2.5" strokeWidth={2} />
        {label}
      </Collapsible.Trigger>
      <Collapsible.Panel className="mt-1 border-l-2 border-zGray-800 pl-2 text-main/70 italic">
        <ClampedText text={text} limit={600} />
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}

/** Renders ALL of a message's reasoning — used by the flat audit-events view
 *  (no tool pairing there, so per-command split doesn't apply). */
export function ReasoningBlock({ contentHot }: { contentHot: unknown }) {
  return <ReasoningText text={journalReasoningText(contentHot)} />
}

export function CredentialGrantBody({ payload }: { payload: Record<string, unknown> }) {
  const access = (payload.access ?? {}) as Record<string, unknown>
  const rows = Object.entries(access).filter(
    ([, value]) => !(Array.isArray(value) && value.length === 0),
  )

  if (rows.length === 0) {
    return <div className="text-[11.5px] text-tertiary">No credentials granted this turn.</div>
  }

  return (
    <div className="space-y-0.5">
      {rows.map(([provider, value]) => (
        <div key={provider} className="flex gap-1.5 text-[11.5px] leading-4">
          <span className="text-tertiary">{provider}:</span>
          <span className="min-w-0 break-all text-main/85">
            {Array.isArray(value) ? value.map(String).join(', ') : String(value)}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Small fold: title row toggles the detail. Scan first, drill down on demand. */
export function Disclosure({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <Collapsible.Root>
      <Collapsible.Trigger
        onClick={(e) => e.stopPropagation()}
        className="group inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-tertiary hover:text-main/80"
      >
        <ChevronRight
          className="h-2.5 w-2.5 transition-transform group-data-[panel-open]:rotate-90"
          strokeWidth={2}
        />
        {summary}
      </Collapsible.Trigger>
      <Collapsible.Panel className="mt-1">{children}</Collapsible.Panel>
    </Collapsible.Root>
  )
}
