import { describe, expect, test } from 'bun:test'

import {
  hashCommand,
  normalizeCommand,
  sanitizeRuleDescription,
  RuleValidationError,
  RULE_DESCRIPTION_MAX_LENGTH,
} from './store'

describe('normalizeCommand', () => {
  test('collapses whitespace and trims', () => {
    expect(normalizeCommand('  kubectl   get    pods\n')).toBe('kubectl get pods')
  })
})

describe('hashCommand', () => {
  test('stable + normalization-invariant', () => {
    expect(hashCommand('kubectl get pods')).toBe(hashCommand('kubectl   get  pods'))
    expect(hashCommand('a')).toMatch(/^[a-f0-9]{32}$/)
    expect(hashCommand('a')).not.toBe(hashCommand('b'))
  })
})

describe('sanitizeRuleDescription', () => {
  test('trims and collapses whitespace', () => {
    expect(sanitizeRuleDescription('  restart   staging  deploys\n')).toBe(
      'restart staging deploys',
    )
  })

  test('rejects empty / whitespace-only input', () => {
    expect(() => sanitizeRuleDescription('   ')).toThrow(RuleValidationError)
    try {
      sanitizeRuleDescription('')
    } catch (err) {
      expect((err as RuleValidationError).code).toBe('rule_description_empty')
    }
  })

  test('accepts a description at the length limit', () => {
    const atLimit = 'a'.repeat(RULE_DESCRIPTION_MAX_LENGTH)

    expect(sanitizeRuleDescription(atLimit)).toBe(atLimit)
  })

  test('rejects an over-length dumped command', () => {
    const raw = `Run: cd /workspace && ${'curl -X DELETE /tasks/123 '.repeat(20)}`

    expect(raw.length).toBeGreaterThan(RULE_DESCRIPTION_MAX_LENGTH)
    try {
      sanitizeRuleDescription(raw)
      throw new Error('expected RuleValidationError')
    } catch (err) {
      expect(err).toBeInstanceOf(RuleValidationError)
      expect((err as RuleValidationError).code).toBe('rule_description_too_long')
    }
  })
})
