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
// "Default", which names the model it stands for and is a new session's model, and
// Claude Code's effort levels, whose "default" names the level it stands for.
const standIn = { value: 'default', name: 'Default (recommended)', description: 'fixture' }
// While a `behind` file beside the log names a model, a session with Nuphos's tools offers it
// and stays on it whatever it was asked to start on; a model probe, opened without them, never
// lists it: the session runs a model its computer's list lacks.
const behind = join(dirname(process.env.E2E_ACP_LOG ?? ''), 'behind')
const unlistedFor = (sessionId) =>
  toolsServer(sessionId) && existsSync(behind) && readFileSync(behind, 'utf8')
const meta = 'ai.nuphos/runtimeDefaults'

/** A new session's params, with no model to start on when it stays on the unlisted one. */
export function heldDefaults(sessionId, params) {
  if (!unlistedFor(sessionId)) return params
  const { model: _model, ...defaults } = params._meta?.[meta] ?? {}

  return { ...params, _meta: { ...params._meta, [meta]: defaults } }
}

const effort = {
  id: 'effort',
  name: 'Effort',
  category: 'thought_level',
  type: 'select',
  currentValue: 'default',
  options: [
    { value: 'default', name: 'Default', description: 'low' },
    choice('low'),
    choice('high'),
  ],
}
const newSettings = (sessionId) => {
  const claudeLike = first && existsSync(process.env.E2E_STAND_IN ?? '')
  const unlisted = unlistedFor(sessionId)
  const listed = unlisted ? [...models, unlisted] : models

  return [
    {
      id: 'model',
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue: claudeLike ? 'default' : unlisted || 'fixture',
      options: [...(claudeLike ? [standIn] : []), ...listed.map(choice)],
    },
    {
      id: 'fast',
      name: 'Fast',
      type: 'select',
      currentValue: 'off',
      options: [choice('off'), choice('on')],
    },
    ...(claudeLike ? [effort] : []),
  ]
}

/** The model a session runs on now, which is the model its next turn receives. */
export const currentModel = (sessionId) =>
  settings.get(sessionId)?.find((option) => option.id === 'model')?.currentValue

/** A session's settings, after setting `id` to `value` when that is on offer; `log` records the request. */
export function applySetting(sessionId, id, value, log) {
  log?.({ sessionId, event: 'setting', detail: `${id}=${value}` })
  const list = settings.get(sessionId) ?? newSettings(sessionId)
  const option = list.find((candidate) => candidate.id === id)

  if (option?.options.some((candidate) => candidate.value === value)) option.currentValue = value
  settings.set(sessionId, list)

  return list
}

/** The response language a turn's prompt names (#3469). */
export function promptLanguage(text) {
  return /Response language: ([^.\n]+)\./.exec(text)?.[1]
}
