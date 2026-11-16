import { existsSync } from 'node:fs'

// Each session's model settings, as a real agent reports and changes them. The first
// agent offers a model the second does not, as two versions of one agent can.
const settings = new Map()
const choice = (value) => ({ value, name: value })
const shared = ['fixture', 'fixture-small']
const first = process.env.E2E_AGENT === 'first'
const models = first ? [...shared, 'fixture-large'] : shared
// While its scenario asks (E2E_STAND_IN), the first agent also offers Claude Code's
// "Default", which names the model it stands for and is a new session's model.
const standIn = { value: 'default', name: 'Default (recommended)', description: 'fixture' }
const newSettings = () => {
  const claudeLike = first && existsSync(process.env.E2E_STAND_IN ?? '')

  return [
    {
      id: 'model',
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue: claudeLike ? 'default' : 'fixture',
      options: [...(claudeLike ? [standIn] : []), ...models.map(choice)],
    },
    {
      id: 'fast',
      name: 'Fast',
      type: 'select',
      currentValue: 'off',
      options: [choice('off'), choice('on')],
    },
  ]
}

/** A session's settings, after setting `id` to `value` when that is on offer. */
export function applySetting(sessionId, id, value) {
  const list = settings.get(sessionId) ?? newSettings()
  const option = list.find((candidate) => candidate.id === id)

  if (option?.options.some((candidate) => candidate.value === value)) option.currentValue = value
  settings.set(sessionId, list)

  return list
}
