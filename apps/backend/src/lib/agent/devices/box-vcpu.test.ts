import { describe, expect, test } from 'bun:test'

import { assertWithinLimit, runningVcpus } from './box-vcpu'

describe('Box vCPU limit', () => {
  test('only running machines count', () => {
    expect(
      runningVcpus([
        { state: 'running', vcpus: 4 },
        { state: 'resuming', vcpus: 4 },
        { state: 'creating', vcpus: 2 },
        { state: 'suspended', vcpus: 4 },
        { state: 'stopped', vcpus: 4 },
        { state: 'deleted', vcpus: 4 },
      ]),
    ).toBe(10)
  })

  test('a Box that fits exactly is allowed; one more vCPU is refused', () => {
    expect(() => assertWithinLimit(12, 8, 4)).not.toThrow()
    expect(() => assertWithinLimit(12, 12, 4)).toThrow(
      expect.objectContaining({ status: 402, code: 'box_vcpu_limit' }),
    )
  })

  test('a limit of 0 means no Boxes', () => {
    expect(() => assertWithinLimit(0, 0, 4)).toThrow(/no Box plan/)
  })
})
