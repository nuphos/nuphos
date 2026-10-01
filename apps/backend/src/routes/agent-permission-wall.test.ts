import { expect, test } from 'bun:test'

import { renderPermissionWallPrompt } from './agent/permission-wall'

test('permission failures explain the gap and support a locally authenticated CLI', () => {
  const prompt = renderPermissionWallPrompt()

  expect(prompt).toContain('exact missing permission')
  expect(prompt).toContain('local_exec')
  expect(prompt).toContain('user-selected device')
  expect(prompt).toContain('aws, gcloud, or az')
  expect(prompt).toContain('Verify its account/project/subscription and identity')
  expect(prompt).toContain('cloud console')
  expect(prompt).not.toContain('propose_permission_grant')
  expect(prompt).not.toContain('permission-admin')
})
