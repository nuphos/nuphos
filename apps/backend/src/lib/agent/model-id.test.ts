// Guards the boot-time rules config.ts applies to every model-id env var.
// These are the PR's stated safety property — "a cross-provider id fails at
// boot, not mid-turn" — and without a test the property is one careless edit
// away from silently disappearing (openab council F2 on #660).
import { describe, expect, test } from 'bun:test'

import {
  assertModelIdMatchesProvider,
  looksLikeBedrockModelId,
  parseModelProvider,
  resolveSmallModelDefault,
} from './model-id'

const BEDROCK_DEFAULT = 'us.anthropic.claude-haiku-4-5-20251001-v1:0'

describe('parseModelProvider', () => {
  test('defaults to bedrock so an unset env keeps prod on its current path', () => {
    expect(parseModelProvider(undefined)).toBe('bedrock')
  })

  test('accepts both providers, case- and whitespace-insensitively', () => {
    expect(parseModelProvider('vertex')).toBe('vertex')
    expect(parseModelProvider('  VERTEX ')).toBe('vertex')
    expect(parseModelProvider('Bedrock')).toBe('bedrock')
  })

  test('rejects anything else rather than falling back to a default', () => {
    // A typo silently falling through to bedrock would send Vertex-shaped ids
    // to Bedrock — the failure this whole guard exists to prevent.
    expect(() => parseModelProvider('vertexai')).toThrow(/must be 'bedrock' or 'vertex'/)
    expect(() => parseModelProvider('')).toThrow(/must be 'bedrock' or 'vertex'/)
  })
})

describe('looksLikeBedrockModelId', () => {
  test.each([
    ['us.anthropic.claude-haiku-4-5-20251001-v1:0', true],
    ['global.anthropic.claude-opus-5', true],
    ['eu.anthropic.claude-sonnet-5', true],
    ['claude-opus-5', false],
    ['claude-haiku-4-5', false],
    ['claude-opus-4-5@20251101', false],
  ])('%s -> %s', (id, expected) => {
    expect(looksLikeBedrockModelId(id as string)).toBe(expected)
  })
})

describe('assertModelIdMatchesProvider', () => {
  test('accepts each provider its own id shape', () => {
    expect(() =>
      assertModelIdMatchesProvider('bedrock', 'AGENT_MODEL_ID', 'global.anthropic.claude-opus-5'),
    ).not.toThrow()
    expect(() =>
      assertModelIdMatchesProvider('vertex', 'AGENT_MODEL_ID', 'claude-opus-5'),
    ).not.toThrow()
  })

  test('rejects a Bedrock inference profile under vertex', () => {
    expect(() =>
      assertModelIdMatchesProvider('vertex', 'AGENT_MODEL_ID', 'global.anthropic.claude-opus-5'),
    ).toThrow(/AGENT_MODEL_ID.*Bedrock inference profile.*AGENT_MODEL_PROVIDER=vertex/s)
  })

  test('rejects a bare Vertex id under bedrock', () => {
    expect(() =>
      assertModelIdMatchesProvider('bedrock', 'AGENT_COMPACTION_MODEL_ID', 'claude-opus-5'),
    ).toThrow(/AGENT_COMPACTION_MODEL_ID.*not a Bedrock inference profile/s)
  })

  test('names the offending env var, so the operator knows which one to fix', () => {
    // Six different envs flow through this check; an error that only said
    // "bad model id" would leave the operator grepping.
    expect(() =>
      assertModelIdMatchesProvider('vertex', 'MEMORY_ATTRIBUTION_JUDGE_MODEL', 'us.anthropic.x'),
    ).toThrow(/MEMORY_ATTRIBUTION_JUDGE_MODEL/)
  })
})

describe('resolveSmallModelDefault', () => {
  test('bedrock keeps the cheap hardcoded default, ignoring the main model', () => {
    expect(
      resolveSmallModelDefault('bedrock', 'global.anthropic.claude-opus-5', BEDROCK_DEFAULT),
    ).toBe(BEDROCK_DEFAULT)
    expect(resolveSmallModelDefault('bedrock', undefined, BEDROCK_DEFAULT)).toBe(BEDROCK_DEFAULT)
  })

  test('vertex reuses the main model, which is the only one entitled by definition', () => {
    // Vertex grants access one model at a time, so a hardcoded cheap default
    // would 404 on the first compaction.
    expect(resolveSmallModelDefault('vertex', 'claude-opus-5', BEDROCK_DEFAULT)).toBe(
      'claude-opus-5',
    )
  })

  test('vertex without a main model fails at boot instead of defaulting to a Bedrock id', () => {
    expect(() => resolveSmallModelDefault('vertex', undefined, BEDROCK_DEFAULT)).toThrow(
      /AGENT_MODEL_ID is required when AGENT_MODEL_PROVIDER=vertex/,
    )
  })
})
