import { expect, test } from 'bun:test'

import { AppError } from '@/lib/errors'

import { OpenAbRpcError } from './openab-acp-errors'
import { steerNotInjected, steerRejected } from './steer-refusal'

test("the runtime's own steering refusal is the expected 409, not a server error", () => {
  const error = steerRejected(new OpenAbRpcError('Runtime cannot accept steering now', -32004))

  expect(error).toBeInstanceOf(AppError)
  expect((error as AppError).status).toBe(409)
  expect((error as AppError).code).toBe('runtime_steering_unavailable')
})

test('any other runtime error is left as it is', () => {
  const busy = new OpenAbRpcError('Runtime operator credential required', -32003)
  const lost = new Error('Conversation runtime changed')

  expect(steerRejected(busy)).toBe(busy)
  expect(steerRejected(lost)).toBe(lost)
})

test('the refusal does not claim a reason the runtime did not give', () => {
  const unsupported = steerRejected(
    new OpenAbRpcError('This session does not support native steering', -32004),
  ) as AppError
  const notInjected = steerNotInjected({ outcome: 'promptRequired' })

  for (const refusal of [unsupported, notInjected]) expect(refusal?.message).not.toContain('ended')
  expect(unsupported.details).toEqual({ reason: 'This session does not support native steering' })
})
