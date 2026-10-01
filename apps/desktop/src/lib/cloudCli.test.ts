import assert from 'node:assert/strict'
import test from 'node:test'

import { cloudCliSetupPrompt } from './cloudCli.ts'

test('handoff pins the detected device, checks authentication and finishes with MCP', () => {
  const prompt = cloudCliSetupPrompt(
    'huawei',
    'team-1',
    {
      installed: true,
      command: 'hcloud',
      path: '/usr/local/bin/hcloud',
      version: '3.2.8',
    },
    { deviceId: 'device-1', label: 'My laptop' },
    true,
  )

  for (const expected of [
    'device-1',
    'My laptop',
    'Local CLI installation was detected',
    '3.2.8',
    '/usr/local/bin/hcloud',
    'IAM 5.0',
    'billing/cost read',
    'create_connector',
    '"huawei"',
    'team-1',
  ]) {
    assert.ok(prompt.includes(expected), expected)
  }
})
