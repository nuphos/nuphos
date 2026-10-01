import clsx from 'clsx'
import { AlertTriangle, Check, Database, DollarSign, Shield, SlidersHorizontal } from 'lucide-react'

import { PlanRevealSection } from './reveal'

import type { MongoDatabasePlanAction } from '../../../api'
import type { PlanCost, PlanDecision, PlanRisk } from '../planPayload'

/**
 * Section shell shared by Decisions / Cost / Risk.
 *
 * Floating: a bare, neutral-colored icon sits inline to the LEFT OF THE TITLE,
 * and the body spans the card's full width below — no left icon gutter, so the
 * icon no longer occupies the whole vertical run of the block.
 *
 * Stacked (non-floating): keeps the tinted icon box in a left column with the
 * title + body to its right.
 */
function PlanSection({
  revealKey,
  floating,
  Icon,
  title,
  titleClassName,
  iconBoxClassName,
  sectionClassName,
  children,
}: {
  revealKey: string | number
  floating?: boolean
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  title: string
  /** Color class for the title text (kept per-section: violet / emerald / red). */
  titleClassName: string
  /** Tinted icon-box classes used only in the stacked (non-floating) layout. */
  iconBoxClassName: string
  /** Extra padding/border/background for the stacked layout's section row. */
  sectionClassName?: string
  children: React.ReactNode
}) {
  if (floating) {
    return (
      <PlanRevealSection revealKey={revealKey} className="px-4 py-3.5">
        <div
          className={clsx(
            'flex items-center gap-2 text-[12px] font-medium leading-relaxed',
            titleClassName,
          )}
        >
          <Icon className="h-3.5 w-3.5 flex-shrink-0 text-secondary" strokeWidth={2} />
          <span>{title}</span>
        </div>
        {children}
      </PlanRevealSection>
    )
  }

  return (
    <PlanRevealSection
      revealKey={revealKey}
      className={clsx('flex items-start gap-2.5', sectionClassName)}
    >
      <div
        className={clsx(
          'mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md',
          iconBoxClassName,
        )}
      >
        <Icon className="h-3.5 w-3.5" strokeWidth={2} />
      </div>
      <div className="min-w-0 flex-1">
        <div className={clsx('text-[12px] font-medium leading-relaxed', titleClassName)}>
          {title}
        </div>
        {children}
      </div>
    </PlanRevealSection>
  )
}

export function PlanDecisionsView({
  decisions,
  floating,
}: {
  decisions: PlanDecision[]
  floating?: boolean
}) {
  return (
    <PlanSection
      revealKey={`decisions-${String(decisions.length)}`}
      floating={floating}
      Icon={SlidersHorizontal}
      title="Decisions"
      titleClassName="text-zViolet-accent/90"
      iconBoxClassName="bg-zViolet-500/15 text-zViolet-accent"
      sectionClassName="border-b border-zGray-800/70 bg-zGray-900/30 px-3.5 py-2.5"
    >
      <ul className="mt-1.5 space-y-2">
        {decisions.map((d, i) => (
          <li key={i} className="text-[12.5px] leading-relaxed">
            <div className="text-tertiary">{d.label}</div>
            <div className="break-words font-medium text-main">{d.value}</div>
          </li>
        ))}
      </ul>
    </PlanSection>
  )
}

export function PlanDatabaseActionView({
  action,
  floating,
}: {
  action: MongoDatabasePlanAction
  floating?: boolean
}) {
  const origin = action.sourceAgentOrigin ? ` · ${action.sourceAgentOrigin}` : ''
  const source = action.proposalSource === 'agent' ? `Agent${origin}` : 'Human'

  return (
    <PlanSection
      revealKey={`database-action-${action.id}-${action.statementDigest}`}
      floating={floating}
      Icon={Database}
      title={`Database change · ${action.kind.toUpperCase()}`}
      titleClassName="text-sky-300"
      iconBoxClassName="bg-sky-500/15 text-sky-300"
      sectionClassName="border-b border-zGray-800/70 bg-sky-500/[0.025] px-3.5 py-2.5"
    >
      <dl className="mt-1.5 grid grid-cols-[7rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-[12px] leading-relaxed">
        <dt className="text-tertiary">Namespace</dt>
        <dd className="break-all font-mono text-main">
          {action.database}.{action.collection}
        </dd>
        <dt className="text-tertiary">Operation</dt>
        <dd className="font-mono text-main">{action.operation}</dd>
        <dt className="text-tertiary">Proposed by</dt>
        <dd className="text-main">{source}</dd>
        <dt className="text-tertiary">Executors</dt>
        <dd className="text-main">{action.authorizedExecutorUserIds.length} authorized</dd>
        {action.expiresAt && (
          <>
            <dt className="text-tertiary">Expires</dt>
            <dd className="text-main">{new Date(action.expiresAt).toLocaleString()}</dd>
          </>
        )}
      </dl>
      <div className="mt-2 text-[11.5px] font-medium leading-relaxed text-tertiary">
        Approved statement preview
      </div>
      <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-sky-500/20 bg-zGray-950/70 px-2.5 py-2 font-mono text-[12px] leading-relaxed text-sky-100 scrollbar-thin">
        {action.statementPreview}
      </pre>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] leading-relaxed text-tertiary">
        <span className="break-all font-mono">digest {action.statementDigest}</span>
        {action.statementPreviewTruncated && <span>Preview truncated</span>}
        {action.statementRedactedFields.length > 0 && (
          <span>{action.statementRedactedFields.length} sensitive field(s) redacted</span>
        )}
      </div>
    </PlanSection>
  )
}

export function PlanCostView({ cost, floating }: { cost: PlanCost; floating?: boolean }) {
  const lines: { label: string; value: string; tone: 'cost' | 'savings' }[] = []

  if (cost.oneTime) lines.push({ label: 'One-time', value: cost.oneTime, tone: 'cost' })
  if (cost.monthly) lines.push({ label: 'Monthly', value: cost.monthly, tone: 'cost' })
  if (cost.savings) lines.push({ label: 'Savings', value: cost.savings, tone: 'savings' })

  return (
    <PlanSection
      revealKey={`cost-${cost.summary}`}
      floating={floating}
      Icon={DollarSign}
      title="Cost"
      titleClassName="text-emerald-400/90"
      iconBoxClassName="bg-emerald-500/15 text-emerald-400"
      sectionClassName="px-3.5 py-2.5"
    >
      <div className="mt-0.5 text-[13px] text-main leading-relaxed">{cost.summary}</div>
      {lines.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {lines.map((line, i) => (
            <li key={i} className="flex items-baseline gap-2 text-[12.5px] leading-relaxed">
              <span className="w-16 flex-shrink-0 text-tertiary">{line.label}</span>
              <span
                className={clsx(
                  'min-w-0 flex-1 break-words',
                  line.tone === 'savings' ? 'text-emerald-400' : 'text-secondary',
                )}
              >
                {line.value}
              </span>
            </li>
          ))}
        </ul>
      )}
    </PlanSection>
  )
}

export function PlanRiskView({ risk, floating }: { risk: PlanRisk; floating?: boolean }) {
  return (
    <PlanSection
      revealKey={`risk-${risk.worstCase}`}
      floating={floating}
      Icon={AlertTriangle}
      title="Risk"
      titleClassName="text-zOrangered-400/90"
      iconBoxClassName="bg-zOrangered-500/15 text-zOrangered-400"
      sectionClassName="px-3.5 py-2.5"
    >
      <div className="mt-0.5 text-[13px] leading-relaxed text-main">
        <span className="text-tertiary">Worst case: </span>
        <span>{risk.worstCase}</span>
      </div>
      {risk.mitigations.length > 0 && (
        <div className="mt-2">
          <div className="flex items-center gap-1.5 text-[11.5px] leading-relaxed text-tertiary">
            <Shield className="h-3 w-3" strokeWidth={2} />
            <span>Mitigations</span>
          </div>
          <ul className="mt-1 space-y-0.5">
            {risk.mitigations.map((m, i) => (
              <li
                key={i}
                className="flex items-start gap-1.5 text-[12.5px] leading-relaxed text-secondary"
              >
                <Check
                  className="mt-1 h-2.5 w-2.5 flex-shrink-0 text-emerald-400"
                  strokeWidth={3}
                />
                <span className="min-w-0 flex-1 break-words">{m}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </PlanSection>
  )
}
