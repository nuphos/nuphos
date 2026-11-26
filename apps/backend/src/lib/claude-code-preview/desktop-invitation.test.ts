import { afterEach, beforeEach, expect, test } from 'bun:test'

import { recheckInvitation } from './desktop-invitation'

import type { Invited } from './desktop-invitation'

// Run with: cd apps/backend && bun test src/lib/claude-code-preview/desktop-invitation.test.ts

const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

let rejections: unknown[] = []
const record = (reason: unknown) => {
  rejections.push(reason)
}

beforeEach(() => {
  rejections = []
  process.on('unhandledRejection', record)
})
afterEach(() => {
  process.off('unhandledRejection', record)
})

test('a check that never answers is no invitation', async () => {
  const answers: (Invited | undefined)[] = []
  const stop = recheckInvitation(
    () => new Promise(() => {}),
    5,
    (now) => answers.push(now),
  )

  await settle()
  stop()
  expect(answers.length).toBeGreaterThan(0)
  expect(answers.every((now) => now === undefined)).toBe(true)
})

test('an apply that throws leaves no unhandled rejection, and the checks go on', async () => {
  let applied = 0
  const stop = recheckInvitation(
    async () => 'view',
    5,
    () => {
      applied++
      throw new Error('the socket is already closed')
    },
  )

  await settle()
  stop()
  expect(applied).toBeGreaterThan(1)
  expect(rejections).toEqual([])
})

test('a check slower than the interval but within the wait still answers', async () => {
  const answers: (Invited | undefined)[] = []
  const stop = recheckInvitation(
    () => new Promise((resolve) => setTimeout(() => resolve('view'), 15)),
    5,
    (now) => answers.push(now),
    100,
  )

  await settle()
  await settle()
  stop()
  expect(answers.length).toBeGreaterThan(0)
  expect(answers.every((now) => now === 'view')).toBe(true)
})
