// Each session's model settings, as a real agent reports and changes them. The first
// agent offers a model the second does not, as two versions of one agent can.
const settings = new Map()
const choice = (value) => ({ value, name: value })
const models = process.env.E2E_AGENT === 'first' ? ['fixture', 'fixture-large'] : ['fixture']
const newSettings = () => [
  {
    id: 'model',
    name: 'Model',
    category: 'model',
    type: 'select',
    currentValue: 'fixture',
    options: models.map(choice),
  },
  {
    id: 'fast',
    name: 'Fast',
    type: 'select',
    currentValue: 'off',
    options: [choice('off'), choice('on')],
  },
]

/** A session's settings, after setting `id` to `value` when that is on offer. */
export function applySetting(sessionId, id, value) {
  const list = settings.get(sessionId) ?? newSettings()
  const option = list.find((candidate) => candidate.id === id)

  if (option?.options.some((candidate) => candidate.value === value)) option.currentValue = value
  settings.set(sessionId, list)

  return list
}
