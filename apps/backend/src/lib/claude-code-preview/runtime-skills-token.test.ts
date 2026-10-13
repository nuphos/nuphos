import { describe, expect, test } from 'bun:test'

import { previewSessionAccess } from './credentials-mcp'
import { mintRuntimeSkillsToken, verifyRuntimeSkillsToken } from './runtime-skills-token'

describe('runtime skills token', () => {
  test('round-trips only the signed team identity', () => {
    const token = mintRuntimeSkillsToken('team-1')

    expect(verifyRuntimeSkillsToken(token)).toEqual({ teamId: 'team-1' })
    expect(verifyRuntimeSkillsToken(`${token}x`)).toBeNull()
    expect(verifyRuntimeSkillsToken(mintRuntimeSkillsToken('team-2'))).toEqual({ teamId: 'team-2' })
  })

  test('carries the actor when one is named, and the actor cannot be swapped', () => {
    const token = mintRuntimeSkillsToken('team-1', 'user-1')
    const [prefix, , expiresAt, signature] = token.split('.')
    const forged = Buffer.from('team-1:user-2', 'utf8').toString('base64url')

    expect(verifyRuntimeSkillsToken(token)).toEqual({ teamId: 'team-1', userId: 'user-1' })
    expect(verifyRuntimeSkillsToken(`${prefix}.${forged}.${expiresAt}.${signature}`)).toBeNull()
  })

  test('expires, and the expiry cannot be extended without the signature', () => {
    const minted = mintRuntimeSkillsToken('team-1')
    const [prefix, team, expiresAt, signature] = minted.split('.')

    expect(verifyRuntimeSkillsToken(minted, Number(expiresAt) - 1)).toEqual({ teamId: 'team-1' })
    expect(verifyRuntimeSkillsToken(minted, Number(expiresAt))).toBeNull()
    expect(
      verifyRuntimeSkillsToken(
        `${prefix}.${team}.${String(Number(expiresAt) + 86_400_000)}.${signature}`,
      ),
    ).toBeNull()
  })
})

// The suite runs off-cluster with NUPHOS_PUBLIC_BACKEND_URL seeded, so an
// external session resolves to exactly that base.
describe('skill bundle delivery over the session', () => {
  test('only a self-hosted runtime is told where to fetch its bundle', () => {
    const managed = previewSessionAccess('conv-1', 'team-1', 'user-1')
    const external = previewSessionAccess('conv-1', 'team-1', 'user-1', 'user-1', {
      external: true,
    })

    expect(managed.runtimeEnv?.NUPHOS_RUNTIME_SKILLS_URL).toBeUndefined()
    expect(managed.runtimeEnv?.NUPHOS_RUNTIME_SKILLS_TOKEN).toBeUndefined()
    expect(external.runtimeEnv?.NUPHOS_RUNTIME_SKILLS_URL).toBe(
      'https://unit-test.invalid/internal/claude-code-runtime-skills/team-1',
    )
    // An owner's own turn may load their personal skills.
    expect(
      verifyRuntimeSkillsToken(external.runtimeEnv?.NUPHOS_RUNTIME_SKILLS_TOKEN ?? ''),
    ).toEqual({ teamId: 'team-1', userId: 'user-1' })
    // A guest's turn names nobody: neither the guest's skills nor the owner's.
    const guest = previewSessionAccess('conv-1', 'team-1', 'user-2', 'user-1', { external: true })

    expect(verifyRuntimeSkillsToken(guest.runtimeEnv?.NUPHOS_RUNTIME_SKILLS_TOKEN ?? '')).toEqual({
      teamId: 'team-1',
    })
  })
})
