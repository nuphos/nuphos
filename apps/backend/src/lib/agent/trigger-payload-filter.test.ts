import { describe, expect, test } from 'bun:test'

import { matchesPayloadFilters, parsePayloadFilters } from './trigger-payload-filter'

const pr = { action: 'labeled', sender: { login: 'ci[bot]' }, number: 7 }

describe('matchesPayloadFilters', () => {
  test('no rules lets everything through', () => {
    expect(matchesPayloadFilters(pr)).toBe(true)
    expect(matchesPayloadFilters(pr, [])).toBe(true)
  })

  test('in passes only listed values, notIn blocks listed ones, and all rules must hold', () => {
    const open = [{ path: 'action', in: ['opened', 'synchronize'] }]

    expect(matchesPayloadFilters({ action: 'opened' }, open)).toBe(true)
    expect(matchesPayloadFilters(pr, open)).toBe(false)
    expect(matchesPayloadFilters(pr, [{ path: 'sender.login', notIn: ['ci[bot]'] }])).toBe(false)
    expect(
      matchesPayloadFilters({ action: 'opened', sender: { login: 'ci[bot]' } }, [
        ...open,
        { path: 'sender.login', notIn: ['ci[bot]'] },
      ]),
    ).toBe(false)
  })

  test('a missing or non-string value fails in and passes notIn', () => {
    expect(matchesPayloadFilters({}, [{ path: 'action', in: ['opened'] }])).toBe(false)
    expect(matchesPayloadFilters({ action: 7 }, [{ path: 'action', in: ['7'] }])).toBe(false)
    expect(matchesPayloadFilters({ raw: 'x' }, [{ path: 'a.b', notIn: ['x'] }])).toBe(true)
    expect(matchesPayloadFilters(null, [{ path: 'a', notIn: ['x'] }])).toBe(true)
  })
})

describe('matchesPayloadFilters own properties', () => {
  test('inherited keys such as constructor and __proto__ are not read', () => {
    const payload = { action: 'opened' }

    expect(matchesPayloadFilters(payload, [{ path: 'constructor.name', in: ['Object'] }])).toBe(
      false,
    )
    expect(matchesPayloadFilters(payload, [{ path: '__proto__.x', notIn: ['y'] }])).toBe(true)
    expect(matchesPayloadFilters(payload, [{ path: 'action', in: ['opened'] }])).toBe(true)
  })
})

describe('parsePayloadFilters', () => {
  test('accepts a valid list and drops nothing', () => {
    const rules = [{ path: 'sender.login', in: ['a'], notIn: ['b'] }]

    expect(parsePayloadFilters('webhook', rules)).toEqual(rules)
    expect(parsePayloadFilters('webhook', [])).toEqual([])
  })

  test.each([
    ['cron trigger', 'cron', [{ path: 'a', in: ['x'] }]],
    ['not a list', 'webhook', { path: 'a' }],
    ['no in or notIn', 'webhook', [{ path: 'a' }]],
    ['bad path', 'webhook', [{ path: 'a..b', in: ['x'] }]],
    ['expression-like key', 'webhook', [{ path: 'a', in: ['x'], regex: '.*' }]],
    ['empty values', 'webhook', [{ path: 'a', in: [] }]],
    ['non-string value', 'webhook', [{ path: 'a', in: [1] }]],
    ['too many rules', 'webhook', Array.from({ length: 11 }, () => ({ path: 'a', in: ['x'] }))],
  ] as const)('rejects %s', (_name, type, value) => {
    expect(() => parsePayloadFilters(type, value)).toThrow()
  })
})
