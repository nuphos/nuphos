import assert from 'node:assert/strict'
import { test } from 'node:test'

import { outdatedNotice } from './computerOutdated.ts'

import type { AgentDevice } from '../../api/device-types.ts'

const computer = (over: Partial<AgentDevice>): AgentDevice => ({
  deviceId: 'd1',
  label: 'Studio Mac',
  platform: 'darwin',
  access: 'owner',
  outdated: 'desktop',
  ...over,
})
const box = { provider: 'instabox', state: 'running' } as AgentDevice['box']

test('a computer on a supported Nuphos says nothing', () => {
  assert.equal(outdatedNotice(computer({ outdated: undefined }), false), null)
})

test('every outdated computer says so in the same words', () => {
  for (const device of [computer({}), computer({ box, outdated: 'cli' })])
    assert.equal(outdatedNotice(device, false)?.text, 'Nuphos on this computer is out of date')
})

test('the way to update is the one this viewer has for this computer', () => {
  const hint = (over: Partial<AgentDevice>, thisComputer = false) =>
    outdatedNotice(computer(over), thisComputer)?.hint

  // A Box updates from its menu, for whoever manages it.
  assert.equal(hint({ box, outdated: 'cli', access: 'manage' }), 'Update it from its ⋯ menu.')
  assert.equal(
    hint({ box, outdated: 'cli', access: 'use' }),
    'Ask a workspace administrator to update it.',
  )
  // The app the viewer is looking at.
  assert.equal(hint({}, true), 'Restart Nuphos from the Help menu to update it.')
  // Another of the viewer's computers: from here once its update is downloaded.
  assert.equal(
    hint({ app: { version: '0.119.0', update: { version: '0.125.0', ready: true } } }),
    'Update it from its ⋯ menu.',
  )
  assert.equal(hint({ app: { version: '0.119.0' } }), 'Open Nuphos on it and restart to update.')
  assert.equal(hint({ outdated: 'cli' }), 'Run “nuphos update” on it.')
  // A teammate's computer is its owner's to update.
  assert.equal(hint({ access: 'use' }), 'Ask its owner to update Nuphos on it.')
  assert.equal(hint({ access: 'manage', outdated: 'cli' }), 'Ask its owner to update Nuphos on it.')
})
