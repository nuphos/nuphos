import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { toolsServer } from './fixture-mcp.mjs'

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
// While its scenario asks (a `behind` file beside the log, naming a model), the list a session
// opened without Nuphos's tools reads, as a model probe opens one, lacks that model: the
// agent's list is behind the model its running sessions are on.
const behind = join(dirname(process.env.E2E_ACP_LOG ?? ''), 'behind')
const newSettings = (sessionId) => {
  const claudeLike = first && existsSync(process.env.E2E_STAND_IN ?? '')
  const unlisted = !toolsServer(sessionId) && existsSync(behind) && readFileSync(behind, 'utf8')
  const listed = models.filter((model) => model !== unlisted)

  return [
    {
      id: 'model',
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue: claudeLike ? 'default' : listed[0],
      options: [...(claudeLike ? [standIn] : []), ...listed.map(choice)],
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

/** A session's settings, after setting `id` to `value` when that is on offer; `log` records the request. */
export function applySetting(sessionId, id, value, log) {
  log?.({ sessionId, event: 'setting', detail: `${id}=${value}` })
  const list = settings.get(sessionId) ?? newSettings(sessionId)
  const option = list.find((candidate) => candidate.id === id)

  if (option?.options.some((candidate) => candidate.value === value)) option.currentValue = value
  settings.set(sessionId, list)

  return list
}
