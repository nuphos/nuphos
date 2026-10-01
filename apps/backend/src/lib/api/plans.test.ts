import { describe, expect, test } from 'bun:test'
import { z } from 'zod'

import {
  agentAddPlanStepInputSchema,
  agentCreatePlanInputSchema,
  agentEditPlanStepInputSchema,
  backfillPlanCreateInput,
  backfillStepTitleFromLabel,
  extractLegacyPlanCreateExtras,
  normalizeAgentPlanMetaInput,
  normalizeAgentPlanStepInput,
  normalizeAgentPlanUpdatePatch,
  planUpdateOperation,
  updatePlanBodySchema,
} from './plans'

// The label field every agent tool carries (transient UI status text). Mirrors
// the definition in tools-skilled.ts so these tests exercise the same
// preprocess + schema composition the live tools use.
const labelField = z.string().min(1).max(160)

const addStepSchema = z.preprocess(
  backfillStepTitleFromLabel,
  z.object({ label: labelField }).merge(agentAddPlanStepInputSchema),
)
const editStepSchema = z.preprocess(
  backfillStepTitleFromLabel,
  z.object({ label: labelField }).merge(agentEditPlanStepInputSchema),
)
const createSchema = z.preprocess(
  backfillPlanCreateInput,
  z.object({ label: labelField }).merge(agentCreatePlanInputSchema).passthrough(),
)

describe('backfillPlanCreateInput', () => {
  test('backfills title from label when only label is present', () => {
    const out = backfillPlanCreateInput({ label: '建立部署計畫' }) as Record<string, unknown>

    expect(out.title).toBe('建立部署計畫')
    expect(out.label).toBe('建立部署計畫')
  })

  test('backfills label from title (truncated to 160) when only title is present', () => {
    const title = 'T'.repeat(200)
    const out = backfillPlanCreateInput({ title }) as Record<string, unknown>

    expect(out.label).toBe('T'.repeat(160))
    expect(out.title).toBe(title)
  })

  test('leaves both-present untouched', () => {
    const input = { label: 'L', title: 'T' }

    expect(backfillPlanCreateInput(input)).toBe(input)
  })

  test('leaves both-absent untouched so the schema can reject it', () => {
    const input = { overview: 'x' }

    expect(backfillPlanCreateInput(input)).toBe(input)
  })

  test('passes through non-objects', () => {
    expect(backfillPlanCreateInput(null)).toBeNull()
    expect(backfillPlanCreateInput('x')).toBe('x')
  })
})

describe('backfillStepTitleFromLabel', () => {
  test('backfills step.title from label when missing', () => {
    const out = backfillStepTitleFromLabel({
      label: '步骤二：部署 VMAlertmanager',
      step: { jobs: [] },
    }) as { step: { title: string } }

    expect(out.step.title).toBe('步骤二：部署 VMAlertmanager')
  })

  test('keeps an existing step.title', () => {
    const input = { label: 'L', step: { title: 'real title', jobs: [] } }

    expect(backfillStepTitleFromLabel(input)).toBe(input)
  })

  test('no-op when label is empty or step is missing/non-object', () => {
    const noLabel = { step: { jobs: [] } }

    expect(backfillStepTitleFromLabel(noLabel)).toBe(noLabel)
    const noStep = { label: 'L' }

    expect(backfillStepTitleFromLabel(noStep)).toBe(noStep)
    const arrStep = { label: 'L', step: [] }

    expect(backfillStepTitleFromLabel(arrStep)).toBe(arrStep)
  })
})

describe('plan_add_step input schema (preprocess + validation)', () => {
  // The exact payload shape that produced every plan_add_step failure in
  // Braintrust: step title written into `label`, `step.title` omitted.
  test('regression: missing step.title is rescued from label', () => {
    const result = addStepSchema.safeParse({
      label: '步骤二：部署 VMAlertmanager',
      planId: '140',
      step: {
        description: '在 observability 部署一个 VMAlertmanager',
        jobs: [
          {
            title: '应用 VMAlertmanager + Secret',
            commands: [{ command: 'kubectl -n observability apply -f /tmp/vm.yaml' }],
          },
        ],
      },
    })

    expect(result.success).toBe(true)
    if (result.success) expect(result.data.step.title).toBe('步骤二：部署 VMAlertmanager')
  })

  test('keeps an explicit step.title over the label', () => {
    const result = addStepSchema.safeParse({
      label: 'status text',
      planId: '1',
      step: { title: 'My title', jobs: [{ title: 'j', commands: [{ command: 'echo' }] }] },
    })

    expect(result.success).toBe(true)
    if (result.success) expect(result.data.step.title).toBe('My title')
  })

  test('accepts insertAt for mid-plan insertion', () => {
    const result = addStepSchema.safeParse({
      label: 'x',
      planId: '1',
      insertAt: 0,
      step: { title: 't', jobs: [{ title: 'j', commands: [{ command: 'echo' }] }] },
    })

    expect(result.success).toBe(true)
    if (result.success) expect(result.data.insertAt).toBe(0)
  })

  test('edit_step gets the same step.title backfill', () => {
    const result = editStepSchema.safeParse({
      label: '改步驟',
      planId: '1',
      stepIdx: 2,
      step: { jobs: [{ title: 'j', commands: [{ command: 'echo' }] }] },
    })

    expect(result.success).toBe(true)
    if (result.success) expect(result.data.step.title).toBe('改步驟')
  })
})

describe('plan_create input schema (preprocess + validation)', () => {
  test('regression: legacy single-call payload without label still validates', () => {
    const result = createSchema.safeParse({
      title: '擴充 Secrets 權限',
      overview: 'x',
      agentRunnable: true,
      costSummary: '~$2/月',
      decisions: [{ label: 'Role', value: 'ZeaburAccessRole' }],
      steps: [{ jobs: [{ title: '更新 IAM policy', commands: [{ command: 'put-role-policy' }] }] }],
      riskWorstCase: 'policy 寫錯導致失效',
      riskMitigations: ['先備份原 policy'],
    })

    expect(result.success).toBe(true)
  })

  test('label-only payload backfills title', () => {
    const result = createSchema.safeParse({ label: '建立部署計畫' })

    expect(result.success).toBe(true)
    if (result.success) expect(result.data.title).toBe('建立部署計畫')
  })

  test('both label and title missing is rejected', () => {
    expect(createSchema.safeParse({ overview: 'x' }).success).toBe(false)
  })
})

describe('extractLegacyPlanCreateExtras', () => {
  test('captures inline decisions/steps/cost/risk from a legacy payload', () => {
    const extras = extractLegacyPlanCreateExtras({
      title: 'T',
      decisions: [{ label: 'Role', value: 'ZeaburAccessRole' }],
      steps: [{ jobs: [{ title: '更新 IAM policy', commands: [{ command: 'put-role-policy' }] }] }],
      costSummary: '~$2/月',
      riskWorstCase: 'x',
      riskMitigations: ['mitigation'],
    })

    expect(extras).not.toBeNull()
    expect(extras?.steps?.length).toBe(1)
    expect(extras?.decisions?.length).toBe(1)
    expect(extras?.costSummary).toBe('~$2/月')
  })

  test('falls back step.title to the first job title when missing', () => {
    const extras = extractLegacyPlanCreateExtras({
      steps: [{ jobs: [{ title: '更新 IAM policy', commands: [{ command: 'put-role-policy' }] }] }],
    })

    expect(extras?.steps?.[0]?.title).toBe('更新 IAM policy')
  })

  test('returns null for a plain shell payload (title/overview only)', () => {
    expect(extractLegacyPlanCreateExtras({ title: 'T', overview: 'O' })).toBeNull()
  })

  test('degrades to null when extras are structurally invalid (step without jobs)', () => {
    // A malformed inline section must not fail plan creation — the caller
    // falls back to an empty shell rather than erroring.
    expect(extractLegacyPlanCreateExtras({ title: 'T', steps: [{ title: 's' }] })).toBeNull()
  })
})

describe('normalizers', () => {
  test('normalizeAgentPlanStepInput truncates a backfilled over-long title to 80 chars', () => {
    const parsed = addStepSchema.safeParse({
      label: 'L'.repeat(120),
      planId: '1',
      step: { jobs: [{ title: 'j', commands: [{ command: 'echo' }] }] },
    })

    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const normalized = normalizeAgentPlanStepInput(parsed.data)

    expect(normalized.step.title).toHaveLength(80)
  })

  test('normalizeAgentPlanStepInput preserves insertAt', () => {
    const normalized = normalizeAgentPlanStepInput({
      planId: '1',
      insertAt: 3,
      step: { title: 't', jobs: [{ title: 'j', commands: [{ command: 'echo' }] }] },
    })

    expect(normalized.insertAt).toBe(3)
  })

  test('normalizeAgentPlanMetaInput truncates title and drops undefined overview', () => {
    const normalized = normalizeAgentPlanMetaInput({
      planId: '1',
      title: 'T'.repeat(200),
    })

    expect(normalized.title?.length).toBe(120)
    expect(normalized.overview).toBeUndefined()
  })
})

describe('updatePlanBodySchema (plan skill REST construction path)', () => {
  test('accepts a pure construction patch (appendStep)', () => {
    const parsed = updatePlanBodySchema.safeParse({
      appendStep: {
        title: 'Create bucket',
        jobs: [{ title: 'aws s3 mb', commands: [{ command: 'aws s3 mb s3://x' }] }],
      },
    })

    expect(parsed.success).toBe(true)
  })

  test('accepts decisions / cost / risk section patches', () => {
    expect(
      updatePlanBodySchema.safeParse({ decisions: [{ label: 'Region', value: 'us-east-1' }] })
        .success,
    ).toBe(true)
    expect(updatePlanBodySchema.safeParse({ costSummary: '~$5/month' }).success).toBe(true)
    expect(
      updatePlanBodySchema.safeParse({
        riskWorstCase: 'Brief 502s',
        riskMitigations: ['rolling restart'],
      }).success,
    ).toBe(true)
  })

  test('accepts step revisions (editStep / removeStep) and meta', () => {
    expect(
      updatePlanBodySchema.safeParse({
        editStep: { stepIdx: 0, step: { title: 'Revised', jobs: [{ title: 'j' }] } },
      }).success,
    ).toBe(true)
    expect(updatePlanBodySchema.safeParse({ removeStep: { stepIdx: 1 } }).success).toBe(true)
    expect(updatePlanBodySchema.safeParse({ title: 'New title' }).success).toBe(true)
  })

  test('still accepts lifecycle / command progress patches', () => {
    expect(updatePlanBodySchema.safeParse({ status: 'executing' }).success).toBe(true)
    expect(
      updatePlanBodySchema.safeParse({
        commandStatuses: [{ stepIdx: 0, jobIdx: 0, cmdIdx: 0, status: 'done' }],
      }).success,
    ).toBe(true)
  })

  test('rejects an empty patch', () => {
    expect(updatePlanBodySchema.safeParse({}).success).toBe(false)
    expect(updatePlanBodySchema.safeParse({ teamId: 't1' }).success).toBe(false)
  })
})

describe('plan_update agent tool lifecycle boundary', () => {
  const inputSchema = planUpdateOperation.agent.inputSchema

  test('does not expose human approval or rejection decisions to the agent', () => {
    expect(inputSchema.safeParse({ planId: '1', status: 'approved' }).success).toBe(false)
    expect(inputSchema.safeParse({ planId: '1', status: 'rejected' }).success).toBe(false)
  })

  test('still exposes execution progress after a human approval', () => {
    expect(inputSchema.safeParse({ planId: '1', status: 'executing' }).success).toBe(true)
    expect(inputSchema.safeParse({ planId: '1', status: 'completed' }).success).toBe(true)
  })
})

describe('normalizeAgentPlanUpdatePatch', () => {
  test('truncates partial cost/risk patches independently (no sibling gating)', () => {
    const long = 'x'.repeat(1000)
    const costOnly = normalizeAgentPlanUpdatePatch({ costOneTime: long })

    expect(costOnly.costOneTime!.length).toBeLessThan(200)

    const riskOnly = normalizeAgentPlanUpdatePatch({ riskWorstCase: long })

    expect(riskOnly.riskWorstCase!.length).toBeLessThanOrEqual(400)

    const mitigationsOnly = normalizeAgentPlanUpdatePatch({ riskMitigations: [long] })

    expect(mitigationsOnly.riskMitigations![0]!.length).toBeLessThanOrEqual(200)
  })

  test('truncates meta and decisions; leaves lifecycle fields untouched', () => {
    const long = 'y'.repeat(1000)
    const out = normalizeAgentPlanUpdatePatch({
      title: long,
      decisions: [{ label: long, value: long }],
      status: 'executing' as const,
    })

    expect(out.title!.length).toBeLessThanOrEqual(120)
    expect(out.decisions![0]!.label.length).toBeLessThanOrEqual(60)
    expect(out.status).toBe('executing')
  })
})
