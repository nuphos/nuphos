import { Fragment } from 'react'

import { locale, t } from '../../../i18n'

import { AgentProviderIcon } from './icons'
import { fill } from './timelineFill'
import { Person, Rule, Runtime } from './timelineParts'

import type { AgentTimelineSetting } from '../../../api/agent-timeline-types'
import type { AgentTimelineEvent } from '../../../api/agent-types'
import type { ReactNode } from 'react'

/** A model, effort or speed, as the picker names it. */
function Value({ children }: { children: ReactNode }) {
  return <span className="shrink-0 font-medium text-secondary">{children}</span>
}

function Actor({ by }: { by: NonNullable<AgentTimelineEvent['by']> }) {
  if (by.type === 'person') return <Person person={by} />
  if (by.type === 'runtime') return <Runtime runtime={by} />
  if (by.type === 'nuphos') return <Value>Nuphos</Value>

  return (
    <>
      {/* A long Task title gives way before anything else on the line, down to a few letters. */}
      <span className="inline-flex min-w-16 shrink-[100] items-center gap-1 overflow-hidden text-secondary">
        <AgentProviderIcon provider={by.provider} className="h-3 w-3 shrink-0" />
        <span className="max-w-[240px] min-w-0 truncate font-medium">{by.title}</span>
      </span>
      <span className="shrink-0">{t('(a Task)')}</span>
    </>
  )
}

const shownValue = ({ setting, to }: AgentTimelineSetting) =>
  setting === 'fast' && to === 'on' ? t('fast mode on') : (to ?? t('Default'))

/** What the new agent picked right after a move, on the move's line. */
export function Picks({ picks = [] }: { picks?: AgentTimelineSetting[] }) {
  return picks.map((pick) => (
    <Fragment key={pick.setting}>
      <span aria-hidden>·</span>
      <Value>{shownValue(pick)}</Value>
    </Fragment>
  ))
}

/** Parts joined the way the language lists them: "A and B", "A, B, and C". */
function list(parts: ReactNode[]) {
  return new Intl.ListFormat(locale, { type: 'conjunction' })
    .formatToParts(parts.map((_, index) => String(index)))
    .map((part, index) => (
      <Fragment key={index}>
        {part.type === 'element' ? parts[Number(part.value)] : part.value}
      </Fragment>
    ))
}

function fastSentence(to?: string) {
  if (to === 'on') return t('{actor} turned fast mode on')
  if (to === 'off') return t('{actor} turned fast mode off')

  return t('{actor} changed fast mode to {to}')
}

function oneChange({ setting, from, to }: AgentTimelineSetting) {
  if (setting === 'fast') return fastSentence(to)
  if (setting === 'model')
    return from
      ? t('{actor} changed the model from {from} to {to}')
      : t('{actor} changed the model to {to}')

  return from
    ? t('{actor} changed effort from {from} to {to}')
    : t('{actor} changed effort to {to}')
}

function newValue({ setting, to }: AgentTimelineSetting) {
  const value = <Value>{to ?? t('Default')}</Value>

  if (setting === 'model') return fill(t('the model to {to}'), { to: value })
  if (setting === 'effort') return fill(t('effort to {to}'), { to: value })
  if (to === 'on') return fill(t('fast mode on'), {})
  if (to === 'off') return fill(t('fast mode off'), {})

  return fill(t('fast mode to {to}'), { to: value })
}

/** One save, or one person's run of changes, as one sentence with the picker's names. */
function settingsSentence(
  event: AgentTimelineEvent,
  settings: AgentTimelineSetting[],
  actor: ReactNode,
) {
  if (event.form === 'set')
    return fill(t('{actor} set {values}'), {
      actor,
      values: settings.map((setting, index) => (
        <Fragment key={setting.setting}>
          {index ? <span aria-hidden>·</span> : null}
          <Value>{shownValue(setting)}</Value>
        </Fragment>
      )),
    })
  const [only] = settings

  if (settings.length !== 1)
    return fill(t('{actor} changed {changes}'), {
      actor,
      // One run of text, so the list's commas sit against their words.
      changes: <span>{list(settings.map(newValue))}</span>,
    })
  const value = (text?: string) => <Value>{text ?? t('Default')}</Value>

  return fill(oneChange(only), {
    actor,
    from: value(only.from),
    to: value(only.to),
  })
}

// The apps as they name themselves; a client not here shows as it sent itself.
const CLIENT: Record<string, string> = {
  desktop: 'Nuphos Desktop',
  ios: 'Nuphos for iOS',
  android: 'Nuphos for Android',
  web: 'Nuphos on the web',
  cli: 'Nuphos CLI',
  api: 'API',
}

/** The whole change, which the line leaves out: each setting's from and to, for whom, from where. */
function settingsTitle(event: AgentTimelineEvent, time: string) {
  const label = { model: t('Model'), effort: t('Effort'), fast: t('Fast mode') }
  const settings = (event.settings ?? []).map(
    ({ setting, from, to }) =>
      `${label[setting]}: ${[from, to ?? t('Default')].filter(Boolean).join(' → ')}`,
  )
  const source = event.client
    ? (CLIENT[event.client] ?? event.client)
    : t('via {source}', { source: event.via ?? '' })

  return [
    time,
    ...settings,
    ...(event.actingFor ? [t('Acting for {name}', { name: event.actingFor })] : []),
    source,
  ].join('\n')
}

/** A change of a conversation's model, effort or fast mode, in the line a runtime move has. */
export function SettingsRule({ event, time }: { event: AgentTimelineEvent; time: string }) {
  // An event from an older backend carries only its sentence.
  if (!event.by || !event.settings) return <Rule title={time}>{event.text}</Rule>

  return (
    <Rule title={settingsTitle(event, time)}>
      {settingsSentence(event, event.settings, <Actor by={event.by} />)}
    </Rule>
  )
}
