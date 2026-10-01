import { faArrowRight, faCheck } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'

import { CloudLogo } from '../../../components/CloudLogo'
import { FIRST_RUN_PROVIDERS, firstRunVocabulary } from '../../../lib/firstRunConnect'

import { Reveal } from './bits'
import { IntegrationDiagram } from './IntegrationDiagram'
import { SavingsPreview } from './savings-preview'

import type { FirstRunProvider, FirstRunVocabulary } from '../../../lib/firstRunConnect'

// ---------------------------------------------------------------------------

// The whole task on one screen: what it buys you, and the cloud it applies to.
//
// The scenario cannot be both specific and complete before a cloud is named —
// the three billing grants answer different questions, so any promise made
// ahead of the choice is either vague or wrong for somebody. It resolves in
// place instead: neutral copy until a cloud is picked, that cloud's own
// scenario the moment one is. The picker stays on screen with the pick marked,
// so changing your mind costs one click rather than a trip backwards.

const NEUTRAL_PITCH =
  'Nuphos starts with one cloud and one read-only grant, made in your own console. It can read nothing else — widen access later if you want more.'

const NEUTRAL_PLAN = [
  'Create the billing read-only identity in your own console, one guided step at a time.',
  'Grant it billing read-only — and nothing else.',
  'Nuphos starts from your billing and works out to what is actually running.',
]

function planFor(v: FirstRunVocabulary): string[] {
  return [
    `Create the billing read-only ${v.noun} in your own ${v.label} console, one guided step at a time.`,
    `Grant it ${v.scopeLabel} — and nothing else.`,
    v.introPayoff,
  ]
}

export function FirstWinIntro({
  provider,
  active,
  onPick,
}: {
  /** `null` until a cloud is chosen — the copy above the picker is neutral
   *  until then. */
  provider: FirstRunProvider | null
  active: boolean
  onPick: (p: FirstRunProvider) => void
}) {
  const v = provider ? firstRunVocabulary(provider) : null
  const plan = v ? planFor(v) : NEUTRAL_PLAN

  return (
    <div className="pt-1">
      <h3 className="text-[15px] font-semibold text-main">
        Find out where you&apos;re overspending{v ? ` on ${v.label}` : ''}
      </h3>
      <p className="mt-1.5 text-[12px] leading-relaxed text-secondary">
        {v
          ? `${v.introPitch} It can read nothing else — widen access later if you want more.`
          : NEUTRAL_PITCH}
      </p>
      {/* Keyed on `active`: the panel stays mounted at width 0, so the chart
          must remount when it opens or the first draw plays invisibly and the
          opener lands mid-loop. */}
      <SavingsPreview key={active ? 'open' : 'closed'} active={active} />
      {/* Under the chart, above the choice: the picture is the promise and the
          plan is what it costs to get it, so they belong together — and both
          are what the user needs before being asked to pick anything. */}
      <div className="mt-4">
        <div className="mb-1.5 text-[10.5px] uppercase tracking-wider text-tertiary">The plan</div>
        <ol className="space-y-2">
          {plan.map((item, i) => (
            <li key={item} className="flex gap-2.5 text-[12px] leading-relaxed text-secondary">
              <span className="mt-0.5 flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full bg-zGray-800 text-[10px] font-medium text-tertiary">
                {i + 1}
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ol>
      </div>
      <CloudPicker selected={provider} onPick={onPick} />
    </div>
  )
}

// ---------------------------------------------------------------------------

function CloudPicker({
  selected,
  onPick,
}: {
  selected: FirstRunProvider | null
  onPick: (p: FirstRunProvider) => void
}) {
  return (
    <div className="mt-4">
      <div className="mb-1.5 text-[10.5px] uppercase tracking-wider text-tertiary">
        Which cloud first?
      </div>
      <div className="space-y-2">
        {FIRST_RUN_PROVIDERS.map((provider) => {
          const v = firstRunVocabulary(provider)
          const available = v.available
          const isSelected = provider === selected

          return (
            <button
              key={provider}
              type="button"
              disabled={!available}
              aria-pressed={isSelected}
              onClick={available ? () => onPick(provider) : undefined}
              className={clsx(
                'group w-full rounded-md border p-3 text-left transition-colors',
                isSelected ? 'border-zViolet-500 bg-zGray-800' : 'border-zGray-800 bg-zGray-850',
                available && !isSelected && 'hover:bg-zGray-800',
                !available && 'cursor-not-allowed',
              )}
            >
              <div className="flex items-center gap-3">
                <CloudLogo provider={provider} size={20} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-main">{v.label}</div>
                  <div className="mt-0.5 text-[11.5px] leading-relaxed text-secondary">
                    You&apos;ll create {provider === 'gcp' ? 'a' : 'an'} {v.noun} in your own
                    console.
                  </div>
                </div>
                {isSelected ? (
                  <FontAwesomeIcon icon={faCheck} className="h-3 w-3 text-zViolet-accent" />
                ) : available ? (
                  <FontAwesomeIcon
                    icon={faArrowRight}
                    className="h-3 w-3 text-tertiary opacity-0 transition-opacity group-hover:opacity-100"
                  />
                ) : (
                  <span className="rounded bg-zGray-800 px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wide text-tertiary">
                    Coming soon
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>
      <p className="pt-3 text-[11.5px] leading-relaxed text-tertiary">
        On something else — Cloudflare, Hetzner, Linode, Alibaba Cloud, Tencent Cloud? Connect it
        from <span className="text-secondary">Connectors</span>. Those use API tokens rather than a
        role that can be widened later, so this walkthrough has nothing to add.
      </p>
    </div>
  )
}

// A recap, not a decision: nothing here needs the user to choose anything.
// The diagram names the console objects they created minutes ago, while the
// memory is fresh. The second role isn't shown or mentioned — the first
// question that reaches past cost data is when creating it makes sense, and
// the agent brings it up on its own at that moment.
export function ConnectedInfo({ provider }: { provider: FirstRunProvider }) {
  const v = firstRunVocabulary(provider)

  return (
    <div className="pt-3">
      <Reveal delay={0}>
        <div className="flex items-start gap-2.5 pb-3">
          <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-success/15">
            <FontAwesomeIcon icon={faCheck} className="h-2.5 w-2.5 text-success" />
          </div>
          <p className="text-[12.5px] leading-relaxed text-secondary">
            Connected. Nuphos can read your {v.label} cost data — and nothing else.
          </p>
        </div>
      </Reveal>

      <Reveal delay={0.12}>
        <IntegrationDiagram provider={provider} />
      </Reveal>

      {/* The boundary as a promise, not a preview: no future roles named
          here — just what happens the day a question steps past the line. */}
      <Reveal delay={0.35}>
        <p className="pt-3 text-[12.5px] leading-relaxed text-secondary">
          The first time a question reaches past cost data, the agent names the exact {v.grantNoun}{' '}
          it&apos;s missing and walks you through granting it. Until then, this is all the access
          Nuphos has.
        </p>
      </Reveal>
    </div>
  )
}
