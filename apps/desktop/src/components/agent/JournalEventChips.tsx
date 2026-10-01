import clsx from 'clsx'
import { ShieldAlert, ShieldCheck, TriangleAlert } from 'lucide-react'
import { useState } from 'react'

const LEVEL_TONE: Record<string, string> = {
  violated: 'text-error bg-error/10 border-error/30',
  live: 'text-sky-400 bg-sky-500/10 border-sky-500/30',
  sealed: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  anchored: 'text-violet-300 bg-violet-500/10 border-violet-500/30',
}

const LEVEL_LABEL: Record<string, string> = {
  violated: 'Integrity violated',
  live: 'Live · chain intact',
  sealed: 'Sealed · WORM',
  anchored: 'Anchored',
}

export function JournalIntegrityBadge({
  level,
  compact = false,
}: {
  level: string
  compact?: boolean
}) {
  const Icon = level === 'violated' ? ShieldAlert : ShieldCheck

  return (
    <span
      className={clsx(
        'inline-flex flex-shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider',
        LEVEL_TONE[level] ?? LEVEL_TONE.live,
      )}
    >
      <Icon className="h-3 w-3" strokeWidth={2} />
      {compact ? level : (LEVEL_LABEL[level] ?? level)}
    </span>
  )
}

export function VerifiedMark({ verified }: { verified: boolean | null | undefined }) {
  if (verified === true) {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[9px] uppercase tracking-wider text-emerald-500/90"
        title="Content matches its chained hash"
      >
        <ShieldCheck className="h-2.5 w-2.5" strokeWidth={2} /> verified
      </span>
    )
  }
  if (verified === false) {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[9px] uppercase tracking-wider text-error"
        title="Content does NOT match its chained hash — it was modified after journaling"
      >
        <TriangleAlert className="h-2.5 w-2.5" strokeWidth={2} /> divergent
      </span>
    )
  }

  return null
}

export function ClampedText({
  text,
  mono = false,
  limit = 280,
}: {
  text: string
  mono?: boolean
  limit?: number
}) {
  const [expanded, setExpanded] = useState(false)
  const clipped = !expanded && text.length > limit

  return (
    <div
      className={clsx(
        'break-words text-[11.5px] leading-4 text-main/85 whitespace-pre-wrap',
        mono && 'font-mono',
      )}
    >
      {clipped ? `${text.slice(0, limit)}…` : text}
      {text.length > limit && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setExpanded((v) => !v)
          }}
          className="ml-1 text-[10px] text-violet-300/90 hover:text-violet-200"
        >
          {expanded ? 'less' : 'more'}
        </button>
      )}
    </div>
  )
}

/** N-secrets-redacted signal — journal-only information the transcript never shows. */
export function RedactionChip({ count }: { count: unknown }) {
  if (typeof count !== 'number' || count <= 0) return null

  return (
    <span
      className="inline-flex flex-shrink-0 items-center rounded border border-amber-500/30 bg-amber-500/10 px-1 py-px text-[9px] uppercase tracking-wider text-amber-400/90"
      title="Secrets were redacted from the journaled copy; an HMAC fingerprint allows equality checks without storing them"
    >
      {count} redacted
    </span>
  )
}

/**
 * Who authorized this tool execution — part of the hashed intent
 * payload, so the attribution itself is tamper-evident. Older events predate
 * the field and render no chip (never guessed).
 */
export function AuthorizationChip({ authorization }: { authorization: unknown }) {
  if (!authorization || typeof authorization !== 'object') return null
  const auth = authorization as { kind?: unknown; planNumber?: unknown }

  if (auth.kind === 'plan-approved') {
    return (
      <span
        className="inline-flex flex-shrink-0 items-center rounded border border-violet-500/30 bg-violet-500/10 px-1 py-px text-[9px] uppercase tracking-wider text-violet-300/90"
        title="An approved plan was active for this conversation when the call was journaled — per-command plan binding is not claimed"
      >
        plan{typeof auth.planNumber === 'number' ? ` #${String(auth.planNumber)}` : ''}
      </span>
    )
  }
  if (auth.kind === 'user-approved') {
    return (
      <span
        className="inline-flex flex-shrink-0 items-center rounded border border-emerald-500/30 bg-emerald-500/10 px-1 py-px text-[9px] uppercase tracking-wider text-emerald-400/90"
        title="The user approved this execution (per-command approval or a standing allow rule)"
      >
        user-approved
      </span>
    )
  }
  if (auth.kind === 'agent-initiated') {
    return (
      <span
        className="inline-flex flex-shrink-0 items-center rounded border border-zGray-700 bg-zGray-800/60 px-1 py-px text-[9px] uppercase tracking-wider text-tertiary"
        title="The agent decided to run this on its own — no plan or per-command approval was in effect"
      >
        agent-initiated
      </span>
    )
  }

  return null
}

/** Desktop-reported results are self-attested — visibly lower trust than server-executed ones. */
export function ClientTrustChip() {
  return (
    <span
      className="inline-flex flex-shrink-0 items-center rounded border border-amber-500/30 bg-amber-500/10 px-1 py-px text-[9px] uppercase tracking-wider text-amber-400/90"
      title="Executed on the desktop and self-reported — not attested by the server"
    >
      client-reported
    </span>
  )
}
