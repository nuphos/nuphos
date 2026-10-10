import { describe, expect, test } from 'bun:test'

import { OPENAB_PROVIDERS } from './runtime-provider'
import {
  assertClaudeCodeSetupConfigured,
  isServerAuthoritativeTranscript,
  resolveConversationAgentRuntime,
  resolveConversationRuntimeId,
  validateRequestedRuntimeId,
  selectClaudeCodeChatEndpoint,
} from './runtime-routing'

import type { AppError } from '@/lib/errors'

describe('assertClaudeCodeSetupConfigured', () => {
  test('allows a workspace with a bound token', () => {
    expect(() => assertClaudeCodeSetupConfigured(true)).not.toThrow()
  })

  test('returns an actionable product error when no agent is set up', () => {
    try {
      assertClaudeCodeSetupConfigured(false)
      throw new Error('expected setup to be refused')
    } catch (error) {
      const appError = error as AppError

      expect(appError.status).toBe(409)
      expect(appError.code).toBe('claude_code_setup_required')
      expect(appError.message).toContain('add an agent')
      expect(appError.message).toContain('Settings → Agent')
    }
  })
})

describe('selectClaudeCodeChatEndpoint', () => {
  test('routes a selected Team to its first runtime', () => {
    const endpoint = { url: 'wss://runtime.example/acp', authKey: 'transport-key' }

    expect(selectClaudeCodeChatEndpoint('claude-code', [endpoint])).toBe(endpoint)
  })

  test('does not silently fall back while a selected runtime is unavailable', () => {
    try {
      selectClaudeCodeChatEndpoint('claude-code', [])
      throw new Error('expected runtime selection to be refused')
    } catch (error) {
      const appError = error as AppError

      expect(appError.status).toBe(503)
      expect(appError.code).toBe('claude_code_runtime_starting')
      expect(appError.message).toContain('not ready yet')
    }
  })

  test('does not move an attached conversation to another ACP runtime', () => {
    const replacement = { url: 'wss://replacement.example/acp', authKey: 'replacement-key' }

    try {
      selectClaudeCodeChatEndpoint('claude-code', [replacement], 'wss://original.example/acp')
      throw new Error('expected attached runtime selection to be refused')
    } catch (error) {
      const appError = error as AppError

      expect(appError.status).toBe(503)
      expect(appError.code).toBe('claude_code_runtime_unavailable')
      expect(appError.message).toContain('It will not be moved to another agent')
    }
  })
})

// Two production conversations still carry the retired `nuphos` stamp; they
// must keep resolving onto Claude Code rather than throwing.
const LEGACY_NUPHOS_CONVERSATION = { agentRuntime: 'nuphos' } as unknown as {
  agentRuntime?: 'claude-code' | 'codex'
}

describe('resolveConversationAgentRuntime', () => {
  test('routes every existing conversation through OpenAB', () => {
    expect(resolveConversationAgentRuntime({ agentRuntime: 'claude-code' }, 'claude-code')).toBe(
      'claude-code',
    )
    expect(resolveConversationAgentRuntime(LEGACY_NUPHOS_CONVERSATION, 'claude-code')).toBe(
      'claude-code',
    )
  })

  test('recognizes a legacy ACP attachment as Claude Code', () => {
    expect(
      resolveConversationAgentRuntime(
        {
          claudeCodePreview: {
            openabSessionId: 'session-1',
            runtimeUrl: 'wss://runtime.example/acp',
          },
        },
        'claude-code',
      ),
    ).toBe('claude-code')
  })

  test('uses the Team default only for an unstamped conversation', () => {
    expect(resolveConversationAgentRuntime(null, 'claude-code')).toBe('claude-code')
  })

  test('different conversations in one workspace can select different runtimes', () => {
    expect(resolveConversationAgentRuntime(null, 'claude-code', 'codex')).toBe('codex')
    expect(resolveConversationAgentRuntime(null, 'claude-code', 'claude-code')).toBe('claude-code')
    expect(resolveConversationAgentRuntime(null, 'codex', 'claude-code')).toBe('claude-code')
  })

  test('a transcript synced before the first turn retains its selected runtime', () => {
    expect(resolveConversationAgentRuntime({ agentRuntime: 'codex' }, 'claude-code')).toBe('codex')
    expect(resolveConversationAgentRuntime({}, 'claude-code', 'codex')).toBe('codex')
  })

  test('a later request cannot switch an established conversation to another provider', () => {
    expect(
      resolveConversationAgentRuntime({ agentRuntime: 'codex' }, 'claude-code', 'claude-code'),
    ).toBe('codex')
    expect(resolveConversationAgentRuntime({ agentRuntime: 'claude-code' }, 'codex', 'codex')).toBe(
      'claude-code',
    )
    expect(resolveConversationAgentRuntime(LEGACY_NUPHOS_CONVERSATION, 'codex', 'codex')).toBe(
      'claude-code',
    )
    expect(
      resolveConversationAgentRuntime(
        {
          claudeCodePreview: {
            openabSessionId: 'legacy',
            runtimeUrl: 'wss://claude/acp',
          },
        },
        'codex',
        'codex',
      ),
    ).toBe('claude-code')
  })
})

describe('Codex conversation routing', () => {
  test('new conversations use the selected provider; old conversations retain theirs', () => {
    expect(resolveConversationAgentRuntime(null, 'codex')).toBe('codex')
    expect(resolveConversationAgentRuntime({ agentRuntime: 'codex' }, 'claude-code')).toBe('codex')
    expect(resolveConversationAgentRuntime({ agentRuntime: 'claude-code' }, 'codex')).toBe(
      'claude-code',
    )
    expect(resolveConversationAgentRuntime(LEGACY_NUPHOS_CONVERSATION, 'codex')).toBe('claude-code')
    expect(
      resolveConversationAgentRuntime(
        { claudeCodePreview: { openabSessionId: 'old', runtimeUrl: 'wss://old/acp' } },
        'codex',
      ),
    ).toBe('claude-code')
  })
  test('Codex setup and runtime failures never fall through to the classic loop', () => {
    expect(() => assertClaudeCodeSetupConfigured(false, 'codex')).toThrow('Codex is not set up')
    expect(() => selectClaudeCodeChatEndpoint('codex', [])).toThrow('Codex agent')
    const endpoint = { url: 'wss://codex/acp', authKey: 'key', provider: 'codex' as const }

    expect(selectClaudeCodeChatEndpoint('codex', [endpoint])).toBe(endpoint)
    expect(() => selectClaudeCodeChatEndpoint('codex', [endpoint], 'wss://gone/acp')).toThrow(
      'It will not be moved',
    )
  })
})

test('Codex ACP metadata carries session context without Claude-specific fields', async () => {
  const { sessionMeta } = await import('./openab-acp-session')

  expect(
    sessionMeta('Nuphos context', { provider: 'codex', env: { NUPHOS_TOKEN: 'actor-token' } }),
  ).toEqual({
    _meta: {
      'ai.nuphos/runtimeAuthority': 2,
      'dev.openab/permissionPolicy': 'relay',
      'dev.openab/credentials': { NUPHOS_TOKEN: 'actor-token' },
      'ai.nuphos/codex': {
        developerInstructions: 'Nuphos context',
        env: { NUPHOS_TOKEN: 'actor-token' },
      },
    },
  })
})

describe('runtime instance selection', () => {
  test('separate conversations can choose two accounts of the same provider', () => {
    expect(resolveConversationRuntimeId(null, 'codex-a')).toBe('codex-a')
    expect(resolveConversationRuntimeId(null, 'codex-b')).toBe('codex-b')
    expect(
      resolveConversationRuntimeId({ agentRuntime: 'codex', runtimeId: 'codex-a' }, 'codex-b'),
    ).toBe('codex-a')
  })
  test('legacy conversations cannot be reassigned by a new instance preference', () => {
    expect(resolveConversationRuntimeId({ agentRuntime: 'codex' }, 'codex-b')).toBeUndefined()
    expect(
      resolveConversationRuntimeId(
        { claudeCodePreview: { openabSessionId: 'old', runtimeUrl: 'wss://old/acp' } },
        'claude-b',
      ),
    ).toBeUndefined()
  })
  test('an unavailable chosen instance never falls through to another account', () => {
    const a = { runtimeId: 'codex-a', url: 'wss://a/acp', authKey: 'a' }
    const b = { runtimeId: 'codex-b', url: 'wss://b/acp', authKey: 'b' }

    expect(selectClaudeCodeChatEndpoint('codex', [a, b], undefined, 'codex-b')).toBe(b)
    expect(() => selectClaudeCodeChatEndpoint('codex', [a], undefined, 'codex-b')).toThrow(
      'not ready yet',
    )
    expect(() => selectClaudeCodeChatEndpoint('codex', [a, b], a.url, 'codex-b')).toThrow(
      'It will not be moved',
    )
  })
  test('instance IDs accept only bounded identifiers', () => {
    for (const value of [undefined, 'development-codex', 'my_instance-123']) {
      expect(() => validateRequestedRuntimeId(value)).not.toThrow()
    }
    for (const value of [null, {}, 12, '', 'a/b', 'x'.repeat(201)]) {
      expect(() => validateRequestedRuntimeId(value)).toThrow('runtimeId')
    }
  })
})

describe('isServerAuthoritativeTranscript', () => {
  test('blocks stale renderer writes to unstamped legacy native conversations', () => {
    expect(
      isServerAuthoritativeTranscript({
        claudeCodePreview: {
          openabSessionId: 'legacy-session',
          runtimeUrl: 'wss://runtime.example/acp',
        },
      }),
    ).toBe(true)
  })

  test('blocks first-message sync before a native conversation exists', () => {
    for (const provider of OPENAB_PROVIDERS) {
      expect(isServerAuthoritativeTranscript(null, provider)).toBe(true)
    }
  })

  test('creation hints do not change authority for an existing legacy transcript', () => {
    expect(isServerAuthoritativeTranscript(LEGACY_NUPHOS_CONVERSATION, 'codex')).toBe(false)
    expect(isServerAuthoritativeTranscript({}, 'codex')).toBe(false)
  })

  test('protects both native providers without applying a creation-time runtime default', () => {
    expect(isServerAuthoritativeTranscript({ agentRuntime: 'claude-code' })).toBe(true)
    expect(isServerAuthoritativeTranscript({ agentRuntime: 'codex' })).toBe(true)
    expect(isServerAuthoritativeTranscript(null)).toBe(false)
    expect(isServerAuthoritativeTranscript({})).toBe(false)
    expect(isServerAuthoritativeTranscript(LEGACY_NUPHOS_CONVERSATION)).toBe(false)
  })
})

// Two production conversations still carry the retired `nuphos` stamp. Nothing
// writes that value any more, so the only requirement is that reading one back
// keeps working.
describe('a conversation left stamped with the retired runtime', () => {
  test('resolves onto Claude Code instead of throwing', () => {
    expect(resolveConversationAgentRuntime(LEGACY_NUPHOS_CONVERSATION, 'codex')).toBe('claude-code')
    expect(
      resolveConversationAgentRuntime(LEGACY_NUPHOS_CONVERSATION, 'claude-code', 'codex'),
    ).toBe('claude-code')
  })

  test('is treated as pinned, so no creation-time runtime id can move it', () => {
    expect(resolveConversationRuntimeId(LEGACY_NUPHOS_CONVERSATION, 'runtime-b')).toBeUndefined()
  })
})

test('Agents behind the ACP shim get one shim-facing shape with the instructions and env', async () => {
  const { sessionMeta } = await import('./openab-acp-session')

  for (const provider of ['grok', 'antigravity', 'opencode'] as const)
    expect(
      sessionMeta('Nuphos context', { provider, env: { NUPHOS_TOKEN: 'actor-token' } }),
    ).toEqual({
      _meta: {
        'ai.nuphos/runtimeAuthority': 2,
        'dev.openab/permissionPolicy': 'relay',
        'dev.openab/credentials': { NUPHOS_TOKEN: 'actor-token' },
        'ai.nuphos/session': {
          systemPrompt: 'Nuphos context',
          env: { NUPHOS_TOKEN: 'actor-token' },
        },
      },
    })
})
