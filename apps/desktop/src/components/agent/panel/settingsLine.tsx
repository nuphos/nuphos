import { Fragment } from 'react'

import { locale, t } from '../../../i18n'
import { effortLabel, modelChoiceLabel } from '../../../lib/configLabels'

import { AgentProviderIcon } from './icons'
import { fill } from './timelineFill'
import { Person, Rule, Runtime } from './timelineParts'

import type { AgentTimelineSetting } from '../../../api/agent-timeline-types'
import type { AgentTimelineEvent } from '../../../api/agent-types'
import type { ReactNode } from 'react'

/** A model, effort or speed, as the picker names it. */
function Value({ children }: { children: ReactNode }) {
  return <span className="font-medium text-secondary">{children}</span>
}

function Actor({ by }: { by: NonNullable<AgentTimelineEvent['by']> }) {
  if (by.type === 'person') return <Person person={by} />
  if (by.type === 'runtime') return <Runtime runtime={by} />
  if (by.type === 'nuphos') return <Value>Nuphos</Value>

  return (
    <>
      <AgentProviderIcon provider={by.provider} className="h-3 w-3 shrink-0 text-secondary" />
      {/* A long Task title gives way before anything else on the line, down to a few letters;
          a minimum on the title alone never pads a short one (#4131). */}
      <span className="max-w-[240px] min-w-[3ch] shrink-[100] truncate font-medium text-secondary">
        {by.title}
      </span>
      <span className="shrink-0">{t('(a Task)')}</span>
    </>
  )
}

/** A value as the picker shows it; none is the runtime's default. */
function valueLabel({ setting }: AgentTimelineSetting, choice?: AgentTimelineSetting['to']) {
  if (!choice) return t('Default')
  const name = choice.name ?? choice.value

  if (setting === 'effort') return effortLabel({ value: choice.value, name })

  return setting === 'model' ? modelChoiceLabel({ name }) : choice.value
}

const shownValue = (setting: AgentTimelineSetting) =>
  setting.setting === 'fast' && setting.to?.value === 'on'
    ? t('fast mode on')
    : valueLabel(setting, setting.to)

/** What the new agent picked right after a move, at the end of the move's line. */
export function Picks({ picks = [] }: { picks?: AgentTimelineSetting[] }) {
  if (!picks.length) return null

  return (
    <span className="min-w-0 truncate">
      {picks.map((pick, index) => (
        <Fragment key={pick.setting}>
          {index ? ' · ' : '· '}
          <span className="font-medium text-secondary">{shownValue(pick)}</span>
        </Fragment>
      ))}
    </span>
  )
}

/** The sentence around its actor. What follows the actor ends in "…" when the line runs out. */
function withActor(template: string, actor: ReactNode, nodes: Record<string, ReactNode>) {
  const [before = '', after = ''] = template.split('{actor}')

  return (
    <>
      {before.trim() ? <span className="shrink-0">{fill(before, nodes)}</span> : null}
      {actor}
      <span className="min-w-0 truncate">{fill(after, nodes)}</span>
    </>
  )
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
  if (setting === 'fast') return fastSentence(to?.value)
  if (setting === 'model')
    return from
      ? t('{actor} changed the model from {from} to {to}')
      : t('{actor} changed the model to {to}')

  return from
    ? t('{actor} changed effort from {from} to {to}')
    : t('{actor} changed effort to {to}')
}

function newValue(change: AgentTimelineSetting) {
  const { setting, to } = change
  const value = <Value>{valueLabel(change, to)}</Value>

  if (setting === 'model') return fill(t('the model to {to}'), { to: value })
  if (setting === 'effort') return fill(t('effort to {to}'), { to: value })
  if (to?.value === 'on') return fill(t('fast mode on'), {})
  if (to?.value === 'off') return fill(t('fast mode off'), {})

  return fill(t('fast mode to {to}'), { to: value })
}

/** One save, or one person's run of changes, as one sentence with the picker's names. */
function settingsSentence(
  event: AgentTimelineEvent,
  settings: AgentTimelineSetting[],
  actor: ReactNode,
) {
  if (event.form === 'set')
    return withActor(t('{actor} set {values}'), actor, {
      values: settings.map((setting, index) => (
        <Fragment key={setting.setting}>
          {index ? ' · ' : null}
          <Value>{shownValue(setting)}</Value>
        </Fragment>
      )),
    })
  const [only] = settings

  if (settings.length !== 1)
    return withActor(t('{actor} changed {changes}'), actor, {
      changes: list(settings.map(newValue)),
    })

  return withActor(oneChange(only), actor, {
    from: <Value>{valueLabel(only, only.from)}</Value>,
    to: <Value>{valueLabel(only, only.to)}</Value>,
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
    (change) =>
      `${label[change.setting]}: ${[
        ...(change.from ? [valueLabel(change, change.from)] : []),
        valueLabel(change, change.to),
      ].join(' → ')}`,
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
