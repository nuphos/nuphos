import assert from 'node:assert/strict'
import { test } from 'node:test'

import { EMPTY_CREDENTIAL_OPTIONS } from './constants.ts'
import {
  allCredentialAccess,
  availableCredentialAccess,
  defaultCredentialAccess,
  pruneCredentialAccessToOptions,
} from './credentialAccess.ts'
import { buildMcpServerCredentialSections } from './credentialSectionsC.ts'
import {
  countSelectedCredentials,
  countTotalCredentials,
} from './credentialSelectorButtonCounts.ts'

test('custom MCP servers stay opt-in in defaultCredentialAccess and allCredentialAccess', () => {
  const options = {
    ...EMPTY_CREDENTIAL_OPTIONS,
    mcpServers: [{ id: '65f000000000000000000001', name: 'Homelab', url: 'https://1.1.1.1/mcp' }],
  }

  assert.deepEqual(defaultCredentialAccess(options).mcpServerIds, [])
  assert.deepEqual(allCredentialAccess(options).mcpServerIds, [])
  assert.deepEqual(availableCredentialAccess(options).mcpServerIds, ['65f000000000000000000001'])
  assert.equal(countTotalCredentials(options), 1)
  assert.equal(
    countSelectedCredentials(
      { ...defaultCredentialAccess(options), mcpServerIds: ['65f000000000000000000001'] },
      options,
    ),
    1,
  )
})

test('pruneCredentialAccessToOptions keeps explicitly selected MCP servers and drops deleted ones', () => {
  const options = {
    ...EMPTY_CREDENTIAL_OPTIONS,
    mcpServers: [{ id: '65f000000000000000000001', name: 'Homelab', url: 'https://1.1.1.1/mcp' }],
  }
  const pruned = pruneCredentialAccessToOptions(
    {
      ...defaultCredentialAccess(options),
      mcpServerIds: ['65f000000000000000000001', '65f000000000000000000099'],
    },
    options,
  )

  assert.deepEqual(pruned.mcpServerIds, ['65f000000000000000000001'])
})

test('buildMcpServerCredentialSections renders admin URLs and handles empty or URL-less options', () => {
  assert.deepEqual(buildMcpServerCredentialSections([]), [])
  assert.deepEqual(
    buildMcpServerCredentialSections([
      { id: '65f000000000000000000001', name: 'Homelab', url: 'https://1.1.1.1/mcp' },
      { id: '65f000000000000000000002', name: 'NoUrl' },
    ]),
    [
      {
        id: 'mcp',
        provider: 'mcp',
        title: 'MCP servers',
        items: [
          {
            id: '65f000000000000000000001',
            label: 'Homelab',
            sublabel: 'https://1.1.1.1/mcp',
          },
          {
            id: '65f000000000000000000002',
            label: 'NoUrl',
            sublabel: '',
          },
        ],
      },
    ],
  )
})
