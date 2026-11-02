import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { cleanCode, completesCode, hasNonDigits, pasteIntoCode, singleFlight } from './codeEntry.ts'

describe('cleanCode', () => {
  it('keeps the first six digits of a typed, pasted or spaced code', () => {
    assert.equal(cleanCode('123 456'), '123456')
    assert.equal(cleanCode('code: 987-654-3'), '987654')
    assert.equal(cleanCode('12a'), '12')
  })
})

describe('hasNonDigits', () => {
  it('flags typed letters, spaces and symbols, not digits', () => {
    assert.ok(hasNonDigits('a'))
    assert.ok(hasNonDigits(' '))
    assert.ok(hasNonDigits('-'))
    assert.ok(!hasNonDigits('7'))
  })
})

describe('pasteIntoCode', () => {
  const empty = { start: 0, end: 0 }

  it('keeps only the code from spaced, dashed or worded pastes', () => {
    for (const text of ['123 456', '123-456', 'Your code: 123456', ' 1 2 3 4 5 6 ']) {
      assert.deepEqual(pasteIntoCode('', empty, text), { code: '123456', caret: 6 }, text)
    }
  })

  it('finds the code beside other numbers', () => {
    assert.equal(pasteIntoCode('', empty, 'Sent 9:41 - code 123456').code, '123456')
  })

  it('replaces digits already in the field with a full pasted code', () => {
    assert.deepEqual(pasteIntoCode('12', { start: 2, end: 2 }, '345678'), {
      code: '345678',
      caret: 6,
    })
  })

  it('inserts a partial paste at the cursor', () => {
    assert.deepEqual(pasteIntoCode('16', { start: 1, end: 1 }, '23 4'), { code: '12346', caret: 4 })
    assert.deepEqual(pasteIntoCode('1299', { start: 2, end: 4 }, 'ab34'), {
      code: '1234',
      caret: 4,
    })
  })

  it('ignores a paste with no digits', () => {
    assert.deepEqual(pasteIntoCode('12', { start: 2, end: 2 }, 'hello'), { code: '12', caret: 2 })
  })
})

describe('completesCode', () => {
  it('submits when the sixth digit lands', () => {
    assert.ok(completesCode('12345', '123456'))
    assert.ok(completesCode('', '123456'), 'pasted or autofilled in one go')
  })

  it('does not submit a partial code or the same full code again', () => {
    assert.ok(!completesCode('1234', '12345'))
    assert.ok(!completesCode('123456', '123456'))
  })

  it('submits a different full code pasted over a wrong one', () => {
    assert.ok(completesCode('111111', '123456'))
  })
})

describe('singleFlight', () => {
  it('sends one request for an auto-submit and an Enter right after it', async () => {
    const calls: string[] = []
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const verify = singleFlight(async (code: string) => {
      calls.push(code)
      await gate
    })

    const auto = verify('123456')
    const enter = verify('123456')

    release?.()
    await Promise.all([auto, enter])
    assert.deepEqual(calls, ['123456'])
  })

  it('lets a retry through once a failed request settles', async () => {
    const calls: string[] = []
    const verify = singleFlight(async (code: string) => {
      calls.push(code)
      throw new Error('Invalid code')
    })

    await assert.rejects(verify('111111'))
    await assert.rejects(verify('111111'))
    assert.deepEqual(calls, ['111111', '111111'])
  })
})
