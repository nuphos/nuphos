import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveAnsiComponent } from './ansi-component.ts'

const Ansi = () => null

test('resolveAnsiComponent accepts the direct ESM interop shape', () => {
  assert.equal(resolveAnsiComponent(Ansi), Ansi)
})

test('resolveAnsiComponent unwraps ansi-to-react CommonJS default exports', () => {
  assert.equal(resolveAnsiComponent({ default: Ansi }), Ansi)
})

test('resolveAnsiComponent rejects module objects without a component', () => {
  assert.throws(() => resolveAnsiComponent({ default: {} }), /did not export a React component/)
})
