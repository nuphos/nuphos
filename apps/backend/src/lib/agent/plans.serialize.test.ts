import { describe, expect, test } from 'bun:test'

import { serializePlanForMemory } from './plan-serialize'

import type { PlanDTO } from './plans'

// Minimal valid PlanDTO; individual tests override only what they exercise.
function makePlan(overrides: Partial<PlanDTO> = {}): PlanDTO {
  return {
    id: '1',
    createdBy: 'user_1',
    number: 1,
    title: 'Untitled',
    steps: [],
    status: 'proposed',
    approvalRequirement: {
      requesterApprovalRequired: true,
      minimumOtherApprovals: 0,
      policySource: 'legacy-default',
      policyVersion: 0,
    },
    approvals: [],
    approvalProgress: {
      requesterApproved: false,
      requesterApprovalRequired: true,
      otherApprovals: 0,
      minimumOtherApprovals: 0,
      satisfied: false,
    },
    actions: [],
    createdAt: '2026-06-18T00:00:00.000Z',
    updatedAt: '2026-06-18T00:00:00.000Z',
    ...overrides,
  }
}

describe('serializePlanForMemory', () => {
  test('renders title with id and status on the first line', () => {
    const out = serializePlanForMemory(
      makePlan({ id: '7', title: 'Deploy API', status: 'completed' }),
    )

    expect(out.split('\n')[0]).toBe('# Plan #7: Deploy API (completed)')
  })

  test('includes overview, decisions, and nested steps', () => {
    const out = serializePlanForMemory(
      makePlan({
        title: 'Deploy API',
        overview: 'Spin up a staging deployment.',
        decisions: [
          { label: 'Region', value: 'asia-east1' },
          { label: 'Replicas', value: '2' },
        ],
        steps: [
          {
            title: 'Create namespace',
            description: 'Provision api-staging.',
            jobs: [{ title: 'Apply namespace manifest', commands: [] }],
          },
        ],
      }),
    )

    expect(out).toContain('Spin up a staging deployment.')
    expect(out).toContain('## Decisions')
    expect(out).toContain('- Region: asia-east1')
    expect(out).toContain('- Replicas: 2')
    expect(out).toContain('## Steps')
    expect(out).toContain('1. Create namespace')
    expect(out).toContain('   Provision api-staging.')
    expect(out).toContain('   - Apply namespace manifest')
  })

  test('omits empty optional sections entirely', () => {
    const out = serializePlanForMemory(makePlan({ title: 'Bare plan' }))

    expect(out).toBe('# Plan #1: Bare plan (proposed)')
    expect(out).not.toContain('## Decisions')
    expect(out).not.toContain('## Steps')
  })

  test('treats blank optional text as absent', () => {
    const out = serializePlanForMemory(
      makePlan({ title: 'Whitespace', overview: '   ', decisions: [] }),
    )

    expect(out).toBe('# Plan #1: Whitespace (proposed)')
  })

  test('never includes cost or risk fields', () => {
    const out = serializePlanForMemory(
      makePlan({
        title: 'Has cost and risk',
        costSummary: '~$45/month',
        costMonthly: '$45',
        costOneTime: '$0',
        riskWorstCase: 'public exposure',
        riskMitigations: ['internal LB only'],
      }),
    )

    expect(out).toBe('# Plan #1: Has cost and risk (proposed)')
    expect(out).not.toContain('Cost')
    expect(out).not.toContain('Risk')
    expect(out).not.toContain('$45')
    expect(out).not.toContain('public exposure')
  })

  test('renders a job description indented under its job', () => {
    const out = serializePlanForMemory(
      makePlan({
        steps: [
          {
            title: 'Step one',
            jobs: [{ title: 'Job one', description: 'Do the thing.', commands: [] }],
          },
        ],
      }),
    )

    expect(out).toContain('   - Job one')
    expect(out).toContain('     Do the thing.')
  })

  test('collapses newlines in the title onto the heading line', () => {
    const out = serializePlanForMemory(makePlan({ title: 'Deploy\nthe API', status: 'completed' }))

    expect(out.split('\n')[0]).toBe('# Plan #1: Deploy the API (completed)')
  })

  test('collapses newlines in decision labels and values', () => {
    const out = serializePlanForMemory(
      makePlan({ decisions: [{ label: 'Target\nregion', value: 'asia-\neast1' }] }),
    )

    expect(out).toContain('- Target region: asia- east1')
    // The decision stays on a single line — no stray wrapped line.
    expect(out.split('\n').filter((l) => l.includes('east1'))).toHaveLength(1)
  })

  test('collapses newlines in step and job titles and descriptions', () => {
    const out = serializePlanForMemory(
      makePlan({
        steps: [
          {
            title: 'Create\nnamespace',
            description: 'Provision\nthe ns.',
            jobs: [{ title: 'Apply\nmanifest', description: 'kubectl\napply', commands: [] }],
          },
        ],
      }),
    )

    expect(out).toContain('1. Create namespace')
    expect(out).toContain('   Provision the ns.')
    expect(out).toContain('   - Apply manifest')
    expect(out).toContain('     kubectl apply')
  })
})
