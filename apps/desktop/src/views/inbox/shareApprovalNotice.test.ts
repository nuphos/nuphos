import assert from 'node:assert/strict'
import test from 'node:test'

// The locale is read once at load, so pick English before the first import.
Object.assign(globalThis, {
  window: { addEventListener() {} },
  localStorage: { getItem: () => 'en' },
})
const { shareApprovalNotice } = await import('./shareApprovalNotice.ts')

test('names the teammate and the computer, and quotes the conversation', () => {
  assert.deepEqual(
    shareApprovalNotice({ deviceLabel: 'Studio Mac', title: 'Fix the build' }, 'Alex'),
    {
      title: 'Alex wants to run an agent on Studio Mac',
      body: '“Fix the build”\nOpen the Inbox to approve or decline.',
    },
  )
})

test('falls back to a teammate, and skips a missing title', () => {
  assert.deepEqual(shareApprovalNotice({ deviceLabel: 'Studio Mac' }, undefined), {
    title: 'A teammate wants to run an agent on Studio Mac',
    body: 'Open the Inbox to approve or decline.',
  })
})
