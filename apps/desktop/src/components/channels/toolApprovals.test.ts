import assert from 'node:assert/strict'
import { test } from 'node:test'

import { pendingToolApprovals } from './toolApprovals.ts'

test('only tool approvals are listed, the oldest first, titled by their tool call', () => {
  assert.deepEqual(
    pendingToolApprovals({
      state: 'active',
      requests: [
        { waitId: 'w2', kind: 'agent-permission', ref: 'call-2', createdAt: 20 },
        { waitId: 'w0', kind: 'client-tool', ref: 'call-0', createdAt: 5 },
        { waitId: 'w1', kind: 'agent-permission', ref: 'call-1', createdAt: 10 },
        { waitId: 'w3', kind: 'agent-permission', createdAt: 1 },
      ],
      tools: [{ id: 'call-1', title: ' kubectl delete pod web ' }],
    }),
    [
      { waitId: 'w1', toolCallId: 'call-1', title: 'kubectl delete pod web', at: 10 },
      { waitId: 'w2', toolCallId: 'call-2', title: '', at: 20 },
    ],
  )
  assert.deepEqual(pendingToolApprovals(undefined), [])
})
