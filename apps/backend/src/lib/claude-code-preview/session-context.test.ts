import { expect, test } from 'bun:test'

import { parseSessionConfigOptions } from './session-config-options'
import { previewSessionPrincipalChanged, turnDefaults, workspaceDirectory } from './session-context'

test('a turn sends the settings stored now, not those the session opened with', () => {
  const session = { runtime: { defaults: { model: 'sol', effort: 'low' } } }
  // Switched to luna in the chat after the session opened; no turn has run since.
  const sessionConfig = parseSessionConfigOptions([
    {
      id: 'model',
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue: 'luna',
      options: [
        { value: 'sol', name: 'Sol' },
        { value: 'luna', name: 'Luna' },
      ],
    },
  ])

  expect(turnDefaults(session, { runtimeDefaults: {}, sessionConfig })).toEqual({ model: 'luna' })
  // No attachment yet: the session's own start settings stand.
  expect(turnDefaults(session, null)).toEqual({ model: 'sol', effort: 'low' })
})

test("a task's folder applies only on the runtime it was picked on", () => {
  const conversation = {
    workspace: { kind: 'folder' as const, path: '/Users/me/infra', runtimeId: 'mac' },
  }

  expect(workspaceDirectory(conversation, 'mac')).toBe('/Users/me/infra')
  // Moved to another computer, or never in a project: the runtime's own folder.
  expect(workspaceDirectory(conversation, 'pod')).toBeUndefined()
  expect(workspaceDirectory({}, 'mac')).toBeUndefined()
})

test('restoring into a new home generation refreshes the runtime context', () => {
  const session = { userId: 'owner', runtime: { env: { NUPHOS_SESSION_HOME_EPOCH: '0' } } }

  expect(
    previewSessionPrincipalChanged(session, 'owner', { env: { NUPHOS_SESSION_HOME_EPOCH: '1' } }),
  ).toBe(true)
  expect(previewSessionPrincipalChanged(session, 'owner', { env: {} })).toBe(false)
})
