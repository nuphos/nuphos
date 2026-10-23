import { effortLabel, modelChoiceLabel } from '../../../lib/configLabels.ts'
import { resolvedEffort } from '../../../lib/effortStops.ts'
import { concreteModelChoices } from '../../../lib/modelChoices.ts'

import type { SessionConfigOption, SessionConfigState } from '../../../api/session-config-types'

export const EFFORT_SHORTCUT = 'ctrl+shift+m'

export function modelName(option: SessionConfigOption) {
  const { current, label } = concreteModelChoices(
    option.options.map((choice) => ({
      ...choice,
      id: choice.value,
      name: modelChoiceLabel(choice),
    })),
    option.currentValue,
  )

  // A runtime's Default is a confirmed selection even when its description
  // does not identify a concrete model. Do not turn it into a loading state.
  const selected = option.options.find((choice) => choice.value === option.currentValue)

  return label ?? current ?? (selected ? modelChoiceLabel(selected) : option.currentValue)
}

export function effortName(option: SessionConfigOption | undefined) {
  const level = option && resolvedEffort(option.options, option.currentValue)
  const choice = option?.options.find((candidate) => candidate.value === level)

  return choice && choice.value !== 'default' ? effortLabel(choice) : ''
}

export function modelHint(
  status: SessionConfigState['status'] | undefined,
  hasModel: boolean,
  busy: boolean,
) {
  if (status === 'offline')
    return 'This runtime is offline. Model settings return when it reconnects.'
  if (busy) return 'Changes apply after this reply.'
  if (status === 'dormant' && !hasModel)
    return 'Send a message to start this agent before changing model settings.'
}

/** The composer around a chip: the nearest ancestor holding its message box. */
export function composerOf(chip: HTMLElement | null) {
  let scope = chip?.parentElement

  while (scope && !scope.querySelector('[aria-label="Message"]')) scope = scope.parentElement

  return scope ?? undefined
}

/** ⌃⇧M belongs to the composer that has focus, or to the only one on screen. */
export function ownsShortcut(chip: HTMLElement, peers = '[data-model-chip]') {
  const scope = composerOf(chip)
  const active = document.activeElement

  if (scope && active && scope.contains(active)) return true

  return (
    (!active || active === document.body) &&
    [...document.querySelectorAll<HTMLElement>(peers)].filter((other) => other.checkVisibility())
      .length === 1
  )
}

/** Why fast mode can't be on, when the runtime says so. Claude reports it
 *  after a turn, as "Faster responses… — requires extra usage…". */
export function fastUnavailableReason(option: SessionConfigOption | undefined) {
  const reason = option?.description?.split(' — ')[1]?.trim()

  if (!option || option.currentValue === 'on' || !reason) return
  const sentence = reason.replace(/\.$/, '')

  return {
    tooltip: `Fast mode ${sentence}.`,
    detail: `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`,
  }
}
