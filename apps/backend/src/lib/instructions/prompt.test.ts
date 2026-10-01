import { beforeEach, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useModels } from '@/lib/test/doubles/models'
import { createFakeInstructionsCollection } from '@/lib/test/fake-instructions-collection'

import type { AgentInstruction } from '@/models'

const TEAM_ID = new ObjectId()
const collection = createFakeInstructionsCollection()
let failReads = false

useModels({
  agentInstructions: () => {
    if (failReads) throw new Error('mongo down')

    return collection
  },
})

const { loadInstructionsBlock, renderInstructionsBlock } = await import('@/lib/instructions/prompt')

let clock = 0

function seed(overrides: Partial<AgentInstruction>): void {
  clock += 1
  const at = new Date(Date.UTC(2026, 0, 1, 0, 0, clock))

  collection.docs.push({
    _id: new ObjectId(),
    teamId: TEAM_ID,
    scope: 'team',
    userId: null,
    title: 'Untitled',
    content: 'Body',
    enabled: true,
    createdAt: at,
    updatedAt: at,
    createdBy: 'admin',
    updatedBy: 'admin',
    ...overrides,
  })
}

beforeEach(() => {
  collection.reset()
  failReads = false
})

describe('renderInstructionsBlock', () => {
  test('returns null when there is nothing to inject', () => {
    expect(renderInstructionsBlock([], [])).toBeNull()
  })

  test('renders team snippets before personal ones under their titles', () => {
    const block = renderInstructionsBlock(
      [{ title: 'Deploys', content: 'Always use blue/green.\n' }],
      [{ title: 'Tone', content: 'Be terse.' }],
    )

    expect(block).toStartWith('<nuphos_instructions>')
    expect(block).toEndWith('</nuphos_instructions>')
    expect(block).toContain('## Team instructions\n\n### Deploys\n\nAlways use blue/green.')
    expect(block).toContain('## Personal instructions\n\n### Tone\n\nBe terse.')
    expect(block?.indexOf('Team instructions')).toBeLessThan(
      block?.indexOf('Personal instructions') ?? -1,
    )
  })

  test('omits an empty group', () => {
    const block = renderInstructionsBlock([], [{ title: 'Tone', content: 'Be terse.' }])

    expect(block).not.toContain('Team instructions')
  })
})

describe('loadInstructionsBlock', () => {
  test('injects only enabled snippets for this team and member, oldest first', async () => {
    seed({ title: 'First team rule', content: 'A' })
    seed({ title: 'Disabled team rule', enabled: false })
    seed({ title: 'Second team rule', content: 'B' })
    seed({ scope: 'personal', userId: 'user-a', title: 'Mine', content: 'C' })
    seed({ scope: 'personal', userId: 'user-b', title: 'Someone else', content: 'D' })
    seed({ teamId: new ObjectId(), title: 'Other team', content: 'E' })

    const block = await loadInstructionsBlock(TEAM_ID.toHexString(), 'user-a')

    expect(block).toContain('### First team rule')
    expect(block).toContain('### Second team rule')
    expect(block).toContain('### Mine')
    expect(block).not.toContain('Disabled team rule')
    expect(block).not.toContain('Someone else')
    expect(block).not.toContain('Other team')
    expect(block?.indexOf('First team rule')).toBeLessThan(block?.indexOf('Second team rule') ?? -1)
  })

  test('skips personal snippets when there is no acting user', async () => {
    seed({ scope: 'personal', userId: 'user-a', title: 'Mine' })

    expect(await loadInstructionsBlock(TEAM_ID.toHexString(), undefined)).toBeNull()
  })

  test('fails soft on an invalid team or a store error', async () => {
    expect(await loadInstructionsBlock('not-a-team', 'user-a')).toBeNull()
    seed({ title: 'Rule' })
    failReads = true
    expect(await loadInstructionsBlock(TEAM_ID.toHexString(), 'user-a')).toBeNull()
  })
})
