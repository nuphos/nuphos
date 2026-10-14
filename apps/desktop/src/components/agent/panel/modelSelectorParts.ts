import { effortLabel, modelChoiceLabel } from '../../../lib/configLabels'
import { resolvedEffort } from '../../../lib/effortStops'
import { concreteModelChoices } from '../../../lib/modelChoices'

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

  return label ?? current ?? ''
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
  stalled: boolean,
) {
  if (status === 'offline')
    return 'This agent is offline. Model settings return when it reconnects.'
  if (busy && stalled)
    return "This agent hasn't responded in a while — it may be stuck. Try reconnecting below."
  if (busy) return 'Changes apply after this reply.'
  if (status === 'dormant' && !hasModel)
    return 'Send a message to start this session before changing model settings.'
}

/** The composer around a chip: the nearest ancestor holding its message box. */
export function composerOf(chip: HTMLElement | null) {
  let scope = chip?.parentElement

  while (scope && !scope.querySelector('[aria-label="Message"]')) scope = scope.parentElement

  return scope ?? undefined
}

/** ⌃⇧M belongs to the composer that has focus, or to the only one on screen. */
export function ownsShortcut(chip: HTMLElement) {
  const scope = composerOf(chip)
  const active = document.activeElement

  if (scope && active && scope.contains(active)) return true

  return (
    (!active || active === document.body) &&
    [...document.querySelectorAll<HTMLElement>('[data-model-chip]')].filter((other) =>
      other.checkVisibility(),
    ).length === 1
  )
}
