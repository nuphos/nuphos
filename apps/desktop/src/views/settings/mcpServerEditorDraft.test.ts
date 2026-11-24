import assert from 'node:assert/strict'
import { test } from 'node:test'

import { draftOf, inputOf, updateDraftUrl } from './mcpServerEditorDraft.ts'

import type { TeamMcpServer } from '../../types/mcp-servers.ts'

const existingServer: TeamMcpServer = {
  id: '65f000000000000000000001',
  name: 'homelab',
  url: 'https://mcp.example.com/mcp',
  headers: ['Authorization', 'X-Tenant'],
  createdAt: '2026-11-24T00:00:00.000Z',
  updatedAt: '2026-11-24T00:00:00.000Z',
}

test('inputOf keeps saved headers when left blank and replaces them when a new value is entered', () => {
  const draft = draftOf(existingServer)

  // Replace the second header, leave the first blank, and add a new header.
  draft.headers[1] = { ...draft.headers[1], value: 'new-tenant' }
  draft.headers.push({ name: 'X-Extra', value: 'extra-value', saved: false })

  assert.deepEqual(inputOf(draft, existingServer.url), {
    name: 'homelab',
    url: 'https://mcp.example.com/mcp',
    headers: [
      { name: 'Authorization' },
      { name: 'X-Tenant', value: 'new-tenant' },
      { name: 'X-Extra', value: 'extra-value' },
    ],
  })
})

test('inputOf sends empty value when a saved header is renamed (saved becomes false)', () => {
  const draft = draftOf(existingServer)

  draft.headers[0] = { name: 'X-Api-Key', value: 'secret-123', saved: false }

  assert.deepEqual(inputOf(draft, existingServer.url), {
    name: 'homelab',
    url: 'https://mcp.example.com/mcp',
    headers: [{ name: 'X-Api-Key', value: 'secret-123' }, { name: 'X-Tenant' }],
  })
})

test('updateDraftUrl clears saved headers when URL changes while keeping unsaved headers', () => {
  const draft = draftOf(existingServer)

  draft.headers.push({ name: 'X-New', value: 'fresh', saved: false })

  // No-op when URL matches the original value.
  const unchanged = updateDraftUrl(draft, existingServer.url, existingServer.url)

  assert.equal(unchanged.headers.length, 3)

  // Changing the URL drops all saved headers, keeping only unsaved rows.
  const changed = updateDraftUrl(draft, 'https://other.example.com/mcp', existingServer.url)

  assert.equal(changed.url, 'https://other.example.com/mcp')
  assert.deepEqual(changed.headers, [{ name: 'X-New', value: 'fresh', saved: false }])
  assert.deepEqual(inputOf(changed, existingServer.url), {
    name: 'homelab',
    url: 'https://other.example.com/mcp',
    headers: [{ name: 'X-New', value: 'fresh' }],
  })
})

test('inputOf drops blank saved headers if URL differs from originalUrl even without updateDraftUrl', () => {
  const draft = {
    ...draftOf(existingServer),
    url: 'https://attacker.example.com/mcp',
  }

  draft.headers[1] = { ...draft.headers[1], value: 're-entered' }

  assert.deepEqual(inputOf(draft, existingServer.url), {
    name: 'homelab',
    url: 'https://attacker.example.com/mcp',
    headers: [{ name: 'X-Tenant', value: 're-entered' }],
  })
})
