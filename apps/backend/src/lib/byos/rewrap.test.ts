import { createCipheriv, randomBytes } from 'node:crypto'

import { afterEach, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { BINDING_SEALERS, findEnvelopes, planRewrap } from './rewrap'
import {
  decryptCustomMcpSecret,
  decryptGrafanaSecret,
  encryptCustomMcpSecret,
  encryptGrafanaSecret,
} from './secrets'

import type { EncryptedSecret } from './secrets'

const OLD = 'bb'.repeat(32)

function sealWith(hexKey: string, plaintext: string): EncryptedSecret {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(hexKey, 'hex'), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

  return {
    v: 1,
    alg: 'A256GCM',
    keyId: 'default',
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }
}

afterEach(() => {
  delete process.env.GRAFANA_BYOK_ENCRYPTION_KEY_PREVIOUS
  delete process.env.CUSTOM_MCP_BYOK_ENCRYPTION_KEY
  delete process.env.CUSTOM_MCP_BYOK_ENCRYPTION_KEY_PREVIOUS
})

describe('findEnvelopes', () => {
  test('walks arrays and nested objects but not BSON values', () => {
    const envelope = sealWith(OLD, 'x')

    expect(
      findEnvelopes(
        [
          {
            id: new ObjectId(),
            oauth: { encryptedAccessToken: envelope, refresh: null },
            at: new Date(),
          },
        ],
        'cloudflareAccounts',
      ),
    ).toEqual([{ path: 'cloudflareAccounts.0.oauth.encryptedAccessToken', envelope }])
  })
})

describe('planRewrap', () => {
  test('moves only envelopes the previous key opens, by the owning field', () => {
    process.env.GRAFANA_BYOK_ENCRYPTION_KEY_PREVIOUS = OLD
    const old = sealWith(OLD, 'glsa_old')
    const current = encryptGrafanaSecret('glsa_current')
    const doc = {
      _id: new ObjectId(),
      grafanaInstances: [
        { id: new ObjectId(), encryptedSaToken: old },
        { id: new ObjectId(), encryptedSaToken: current },
        { id: new ObjectId(), encryptedSaToken: sealWith('cc'.repeat(32), 'lost') },
      ],
      awsRoles: [{ legacy: old }],
      updatedAt: new Date(),
    }

    const { counts, updates } = planRewrap(doc, (field) => BINDING_SEALERS[field])

    expect(counts).toEqual({ current: 1, rewrapped: 0, failed: 1, unmapped: 1, raced: 0 })
    expect(updates.map((u) => u.path)).toEqual(['grafanaInstances.0.encryptedSaToken'])
    expect(updates[0]!.from).toBe(old)

    delete process.env.GRAFANA_BYOK_ENCRYPTION_KEY_PREVIOUS
    expect(decryptGrafanaSecret(updates[0]!.to)).toBe('glsa_old')
  })

  test('rewraps team_mcp_servers headers sealed with CUSTOM_MCP_BYOK_ENCRYPTION_KEY_PREVIOUS', () => {
    process.env.CUSTOM_MCP_BYOK_ENCRYPTION_KEY = 'aa'.repeat(32)
    process.env.CUSTOM_MCP_BYOK_ENCRYPTION_KEY_PREVIOUS = OLD
    const oldHeader = sealWith(OLD, 'Bearer old-mcp-secret')
    const currentHeader = encryptCustomMcpSecret('Bearer current-mcp-secret')
    const doc = {
      _id: new ObjectId(),
      teamId: 'team-1',
      name: 'homelab',
      url: 'https://mcp.example.com/mcp',
      headers: [
        { name: 'Authorization', value: oldHeader },
        { name: 'X-Current', value: currentHeader },
      ],
    }

    const { counts, updates } = planRewrap(doc, (field) =>
      field === 'headers' ? 'customMcp' : undefined,
    )

    expect(counts).toEqual({ current: 1, rewrapped: 0, failed: 0, unmapped: 0, raced: 0 })
    expect(updates.map((u) => u.path)).toEqual(['headers.0.value'])

    delete process.env.CUSTOM_MCP_BYOK_ENCRYPTION_KEY_PREVIOUS
    expect(decryptCustomMcpSecret(updates[0]!.to)).toBe('Bearer old-mcp-secret')
  })
})
