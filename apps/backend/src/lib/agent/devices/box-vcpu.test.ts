import { beforeEach, describe, expect, test } from 'bun:test'

import { useObservability } from '@/lib/test/doubles/observability'

import { assertWithinLimit, runningVcpus } from './box-vcpu'

const logged: { level: string; event: string; properties?: Record<string, unknown> }[] = []

useObservability({
  logEvent: (level, event, properties) => {
    logged.push({ level, event, properties })
  },
})

beforeEach(() => {
  logged.length = 0
})

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
    expect(() => assertWithinLimit('t1', 12, 8, 4)).not.toThrow()
    expect(() => assertWithinLimit('t1', 12, 12, 4)).toThrow(
      expect.objectContaining({ status: 402, code: 'box_vcpu_limit' }),
    )
  })

  test('a limit of 0 says, in the words the app uses, that the plan has no computers and what to do', () => {
    expect(() => assertWithinLimit('t1', 0, 0, 4)).toThrow(
      "Your team's plan doesn't include cloud computers. Choose a computer plan to start one.",
    )
  })

  test('a refusal is logged at warn with the team, so it shows up per team', () => {
    expect(() => assertWithinLimit('t1', 0, 0, 4)).toThrow()
    expect(logged).toEqual([
      {
        level: 'warn',
        event: 'agent.box.vcpu_limit_refused',
        properties: { team_id: 't1', limit_vcpus: 0, used_vcpus: 0, box_vcpus: 4 },
      },
    ])
    assertWithinLimit('t1', 12, 8, 4)
    expect(logged).toHaveLength(1)
  })
})
