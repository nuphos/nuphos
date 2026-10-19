import { expect, test } from 'bun:test'

import { clientInputFilter } from './rfb-client-input'

// Run with: cd apps/backend && bun test src/lib/claude-code-preview/rfb-client-input.test.ts

const version = Buffer.from('RFB 003.008\n')
const handshake = Buffer.concat([version, Buffer.from([1]), Buffer.from([1])])
const update = Buffer.from([3, 0, 0, 0, 0, 0, 5, 0, 3, 20])
const key = Buffer.from([4, 1, 0, 0, 0, 0, 0, 65])
const pointer = Buffer.from([5, 4, 2, 128, 1, 144])
const paste = Buffer.concat([Buffer.from([6, 0, 0, 0, 0, 0, 0, 2]), Buffer.from('hi')])
const fence = Buffer.concat([Buffer.from([248, 0, 0, 0, 0, 0, 0, 1, 3]), Buffer.from('abc')])

test('the handshake and view-only messages pass; input waits for the desktop to be held', () => {
  const filter = clientInputFilter()

  expect(filter.push(handshake, false)).toEqual(handshake)
  expect(filter.push(Buffer.concat([key, update, pointer, fence, paste]), false)).toEqual(
    Buffer.concat([update, fence]),
  )
  expect(filter.push(Buffer.concat([key, pointer, paste]), true)).toEqual(
    Buffer.concat([key, pointer, paste]),
  )
})

test('messages split across frames are reassembled before the type decides', () => {
  const filter = clientInputFilter()

  expect(filter.push(version.subarray(0, 5), false)).toEqual(Buffer.alloc(0))
  expect(
    filter.push(
      Buffer.concat([version.subarray(5), Buffer.from([1, 1]), key.subarray(0, 3)]),
      false,
    ),
  ).toEqual(handshake)
  expect(filter.push(Buffer.concat([key.subarray(3), update.subarray(0, 4)]), false)).toEqual(
    Buffer.alloc(0),
  )
  expect(filter.push(update.subarray(4), false)).toEqual(update)
})

test('an unknown message type, or a foreign protocol, ends the stream', () => {
  expect(clientInputFilter().push(Buffer.from('GET / HTTP/1.1\r\n'), true)).toBeNull()
  const filter = clientInputFilter()

  filter.push(handshake, true)
  expect(filter.push(Buffer.from([7, 0, 0]), true)).toBeNull()
})

test('a paste, or a backlog, beyond 256 KiB ends the stream', () => {
  const filter = clientInputFilter()

  filter.push(handshake, true)
  expect(filter.push(Buffer.from([6, 0, 0, 0, 0, 4, 0, 1]), true)).toBeNull()
  const backlog = clientInputFilter()

  backlog.push(handshake, true)
  expect(backlog.push(Buffer.alloc(256 * 1024 + 1, 0), true)).toBeNull()
})

test('a fence passes while view-only, even split across frames; resize and xvp wait like input', () => {
  const filter = clientInputFilter()
  const resize = Buffer.concat([Buffer.from([251, 0, 0, 0, 5, 0, 1, 0]), Buffer.alloc(16, 1)])
  const xvp = Buffer.from([250, 0, 1, 2])

  filter.push(handshake, false)
  expect(filter.push(fence.subarray(0, 4), false)).toEqual(Buffer.alloc(0))
  expect(filter.push(fence.subarray(4, 10), false)).toEqual(Buffer.alloc(0))
  expect(filter.push(Buffer.concat([fence.subarray(10), resize, xvp]), false)).toEqual(fence)
  expect(filter.push(Buffer.concat([resize, xvp]), true)).toEqual(Buffer.concat([resize, xvp]))
})

test('an extended pointer event is 7 bytes and waits like input; GII is not framed', () => {
  const filter = clientInputFilter()
  const extended = Buffer.from([5, 0x80 | 4, 2, 128, 1, 144, 1])

  filter.push(handshake, false)
  expect(filter.push(Buffer.concat([extended, update]), false)).toEqual(update)
  expect(filter.push(Buffer.concat([extended, update]), true)).toEqual(
    Buffer.concat([extended, update]),
  )
  expect(filter.push(Buffer.from([252, 0, 1, 2]), true)).toBeNull()
})

test('a VNC password answer passes as handshake, then input waits as before', () => {
  const filter = clientInputFilter()
  const answer = Buffer.alloc(16, 4)
  const start = Buffer.concat([version, Buffer.from([2]), answer, Buffer.from([1])])

  expect(filter.push(start, false)).toEqual(start)
  expect(filter.push(Buffer.concat([key, update]), false)).toEqual(update)
})

test('an ARD answer is sized by the key length the server announced', () => {
  const filter = clientInputFilter()
  // Screen Sharing's version, its types (ARD and VNC password), the generator and a 4-byte key.
  const server = Buffer.concat([Buffer.from('RFB 003.889\n'), Buffer.from([2, 30, 2, 0, 2, 0, 4])])
  const answer = Buffer.alloc(128 + 4, 4)

  expect(filter.push(Buffer.concat([version, Buffer.from([30])]), false)).toEqual(
    Buffer.concat([version, Buffer.from([30])]),
  )
  // Its key length unknown, the answer waits rather than being guessed at.
  expect(filter.push(answer.subarray(0, 10), false)).toEqual(Buffer.alloc(0))
  filter.server(server.subarray(0, 14))
  filter.server(server.subarray(14))
  expect(
    filter.push(Buffer.concat([answer.subarray(10), Buffer.from([1]), key, update]), false),
  ).toEqual(Buffer.concat([answer, Buffer.from([1]), update]))
})

test('a security type this does not know ends the stream', () => {
  expect(clientInputFilter().push(Buffer.concat([version, Buffer.from([16, 0])]), true)).toBeNull()
})
