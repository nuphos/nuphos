import { describe, expect, test } from 'bun:test'

import { recallTerms, sharesEnoughQueryTerms } from './recall-relevance'

describe('recallTerms', () => {
  test('drops stop words and folds plurals', () => {
    expect([...recallTerms('Why are the nodes in the clusters NotReady?')]).toEqual([
      'node',
      'cluster',
      'notready',
    ])
  })

  test('segments CJK text', () => {
    expect(recallTerms('資料庫備份').size).toBeGreaterThan(0)
  })
})

describe('sharesEnoughQueryTerms', () => {
  const finding = ['Tenant pods can read node IAM credentials via IMDS', 'imds iam', '']

  test('one common word is not enough', () => {
    expect(sharesEnoughQueryTerms('how many nodes are in the staging cluster', finding)).toBe(false)
  })

  test('a query about the same thing passes', () => {
    expect(sharesEnoughQueryTerms('can tenant pods still reach IMDS on those nodes', finding)).toBe(
      true,
    )
  })

  test('a one-term query needs one shared term', () => {
    expect(sharesEnoughQueryTerms('IMDS', finding)).toBe(true)
  })

  test('word forms that share a stem prefix still match', () => {
    expect(
      sharesEnoughQueryTerms('rotation of the deployment secrets', [
        'Rotate deploy secrets with the rotate-secrets job',
      ]),
    ).toBe(true)
  })

  test('an empty query has nothing to reject on', () => {
    expect(sharesEnoughQueryTerms('the', finding)).toBe(true)
  })
})
