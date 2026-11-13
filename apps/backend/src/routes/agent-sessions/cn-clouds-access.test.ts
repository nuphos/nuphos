import { expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { assertCnAgentAccess } from './cn-clouds'

const binding = { id: new ObjectId(), access: { memberAllowList: ['sender'] } }
const selected = [binding.id.toHexString()]
const check = (principals: string[]) => () =>
  assertCnAgentAccess(binding, selected, principals, 'denied', 'Tencent')

test("refuses a sender's private account in a conversation someone else owns", () => {
  expect(check(['sender'])).not.toThrow()
  expect(check(['sender', 'owner'])).toThrow('not enabled for this agent session')
})
