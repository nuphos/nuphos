import { expect, test } from 'bun:test'

import { connectorToolModule } from './connectors'

const ctx = { userId: 'actor', teamId: 'team', sessionId: 'session', locale: 'en' }

function harness() {
  const calls: unknown[][] = []
  const module = connectorToolModule(
    ctx,
    {
      create: async (...args) => {
        calls.push(args)

        return { roleId: 'created-id', roleArn: 'arn:aws:iam::123456789012:role/Nuphos' }
      },
    },
    { publish: async () => {} },
  )

  return { calls, handler: module.handlers(ctx).create_connector! }
}

test('connects directly using the authenticated actor and team', async () => {
  const { calls, handler } = harness()
  const connector = { provider: 'aws', roleArn: 'arn:aws:iam::123456789012:role/Nuphos' }
  const result = await handler({ label: 'Connect the AWS role', connector })

  expect(result.isError).not.toBe(true)
  expect(calls).toEqual([
    [{ userId: 'actor', teamId: 'team' }, 'aws', { roleArn: connector.roleArn }],
  ])
  expect(result.structuredContent).toMatchObject({ status: 'connected', teamId: 'team' })
})

test('rejects cross-team input, retired purposes, secrets, and malformed identifiers', async () => {
  const { calls, handler } = harness()
  const connector = { provider: 'aws', roleArn: 'arn:aws:iam::123456789012:role/Nuphos' }

  for (const args of [
    { connector, teamId: 'other-team' },
    { connector: { ...connector, purpose: 'permission-admin' } },
    { connector: { ...connector, secretAccessKey: 'not-a-real-secret' } },
    { connector: { provider: 'aws', roleArn: 'invalid' } },
    { connector: { provider: 'azure', label: 'Azure', tenantId: 'invalid' } },
  ]) {
    const result = await handler({ label: 'Connect cloud', ...args })

    expect(result.isError).toBe(true)
  }
  expect(calls).toEqual([])
})

test('does not report a connection when backend validation fails', async () => {
  const module = connectorToolModule(
    ctx,
    {
      create: async () => {
        throw new Error('Requires one of: ADMINISTRATOR')
      },
    },
    { publish: async () => {} },
  )
  const result = await module.handlers(ctx).create_connector!({
    label: 'Connect cloud',
    connector: {
      provider: 'gcp',
      projectId: 'test',
      serviceAccountEmail: 'sa@test.iam.gserviceaccount.com',
    },
  })

  expect(result.isError).toBe(true)
  expect(result.structuredContent).toBeUndefined()
})
