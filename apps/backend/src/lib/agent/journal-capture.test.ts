import { describe, expect, test } from 'bun:test'

import { byCodeUnit } from '@/lib/agent/sort-order'
import { canonicalize, sha256Hex, verifyConversationChain } from '@/lib/journal'

import {
  AgentJournal,
  extractClientToolResults,
  summarizeCredentialAccess,
  wrapToolsWithJournal,
} from './journal-capture'

import type { AgentJournalInit } from './journal-capture'
import type { JournalDoc } from '@/lib/journal'
import type { Collection } from 'mongodb'

type ToolExecute = (input: unknown, options: unknown) => Promise<unknown>

// In-memory stand-in enforcing the journal's two unique indexes (kept local:
// production code must never depend on test doubles).
class FakeCollection {
  docs: JournalDoc[] = []
  failInserts = false

  async findOne(filter: Record<string, unknown>, options?: { sort?: { seq: number } }) {
    let rows = this.docs.filter((doc) =>
      Object.entries(filter).every(([key, value]) => {
        if (key === 'eventId' && typeof value === 'object' && value !== null) {
          const inList = (value as { $in?: string[] }).$in ?? []

          return inList.includes(doc.eventId)
        }

        return (doc as unknown as Record<string, unknown>)[key] === value
      }),
    )

    if (options?.sort?.seq === -1) rows = [...rows].sort((a, b) => b.seq - a.seq)

    return rows[0] ?? null
  }

  find(filter: Record<string, unknown>) {
    const inList = ((filter.eventId as { $in?: string[] }) ?? {}).$in ?? []
    const rows = this.docs.filter((doc) => inList.includes(doc.eventId))

    return { toArray: async () => rows }
  }

  async insertOne(doc: JournalDoc) {
    if (this.failInserts) throw new Error('mongo unavailable (simulated)')
    if (this.docs.some((d) => d.eventId === doc.eventId)) {
      throw Object.assign(new Error('E11000 event_id_unique'), {
        code: 11000,
        keyPattern: { eventId: 1 },
      })
    }
    if (this.docs.some((d) => d.sessionId === doc.sessionId && d.seq === doc.seq)) {
      throw Object.assign(new Error('E11000 session_seq_unique'), {
        code: 11000,
        keyPattern: { sessionId: 1, seq: 1 },
      })
    }
    this.docs.push(structuredClone(doc))

    return { insertedId: doc.eventId }
  }

  asCollection(): Collection<JournalDoc> {
    return this as unknown as Collection<JournalDoc>
  }
}

function makeJournal(
  fake: FakeCollection,
  opts?: {
    activePlan?: { planNumber: number; approvedBy?: string } | null
    resolveActivePlan?: NonNullable<AgentJournalInit['resolveActivePlan']>
  },
) {
  return new AgentJournal({
    userId: 'user-1',
    teamId: 'team-1',
    conversationId: 'conv-1',
    requestId: 'req-1',
    streamId: 'stream-1',
    modelId: 'model-x',
    collection: fake.asCollection(),
    resolveActivePlan: opts?.resolveActivePlan ?? (async () => opts?.activePlan ?? null),
  })
}

const execOpts = { toolCallId: 'call-1' }

describe('wrapToolsWithJournal', () => {
  test('bash success: intent lands before execution, result after, chain verifies', async () => {
    const fake = new FakeCollection()
    const journal = makeJournal(fake)
    const order: string[] = []
    const tools = wrapToolsWithJournal(
      {
        bash: {
          description: 'run bash',
          execute: async (input: unknown) => {
            order.push(`exec:${(input as { command: string }).command}`)
            expect(fake.docs.some((d) => d.type === 'tool_call_intent')).toBe(true)

            return { stdout: 'ok', stderr: '', exitCode: 0 }
          },
        },
      },
      journal,
    )

    const output = await (tools.bash as { execute: ToolExecute }).execute(
      { label: 'List pods', command: 'kubectl get pods' },
      execOpts,
    )

    expect(output).toEqual({ stdout: 'ok', stderr: '', exitCode: 0 })
    expect(order).toEqual(['exec:kubectl get pods'])
    const types = fake.docs.map((d) => d.type)

    expect(types).toEqual(['tool_call_intent', 'tool_call_result'])
    expect(verifyConversationChain(fake.docs).ok).toBe(true)
    const intent = fake.docs[0]!.payload as { toolName: string; inputRedacted: string }

    expect(intent.toolName).toBe('bash')
    expect(intent.inputRedacted).toContain('kubectl get pods')
  })

  test('tool intents stamp their authorization: active plan vs agent-initiated (ZEA-10069)', async () => {
    const planned = new FakeCollection()
    const plannedJournal = makeJournal(planned, {
      activePlan: { planNumber: 243, approvedBy: 'user-9' },
    })
    const plannedTools = wrapToolsWithJournal(
      { bash: { execute: async () => ({ stdout: '', stderr: '', exitCode: 0 }) } },
      plannedJournal,
    )

    await (plannedTools.bash as { execute: ToolExecute }).execute({ command: 'ls' }, execOpts)
    const plannedIntent = planned.docs.find((d) => d.type === 'tool_call_intent')!

    expect((plannedIntent.payload as { authorization: unknown }).authorization).toEqual({
      kind: 'plan-approved',
      basis: 'active-plan',
      planNumber: 243,
      approvedBy: 'user-9',
    })

    const free = new FakeCollection()
    const freeJournal = makeJournal(free)
    const freeTools = wrapToolsWithJournal(
      { bash: { execute: async () => ({ stdout: '', stderr: '', exitCode: 0 }) } },
      freeJournal,
    )

    await (freeTools.bash as { execute: ToolExecute }).execute({ command: 'ls' }, execOpts)
    const freeIntent = free.docs.find((d) => d.type === 'tool_call_intent')!

    expect((freeIntent.payload as { authorization: unknown }).authorization).toEqual({
      kind: 'agent-initiated',
      basis: 'no-active-plan',
    })
    expect(verifyConversationChain(free.docs).ok).toBe(true)
  })

  test('local_exec client results stamp user-approved; other client tools carry no claim', async () => {
    const fake = new FakeCollection()
    const journal = makeJournal(fake)

    await journal.clientToolResults([
      {
        id: 'm1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-local_exec',
            toolCallId: 'c1',
            state: 'output-available',
            output: { exitCode: 0 },
          },
          {
            type: 'tool-port_forward_start',
            toolCallId: 'c2',
            state: 'output-available',
            output: { ok: true },
          },
        ],
      },
    ])
    const results = fake.docs.filter((d) => d.type === 'client_tool_result')

    expect(results).toHaveLength(2)
    const byTool = new Map(
      results.map((d) => [
        (d.payload as { toolName: string }).toolName,
        d.payload as Record<string, unknown>,
      ]),
    )

    expect(byTool.get('local_exec')?.authorization).toEqual({
      kind: 'user-approved',
      basis: 'approval-gate',
    })
    expect('authorization' in (byTool.get('port_forward_start') ?? {})).toBe(false)
  })

  test('authorization lookup failure omits the field and never blocks the intent', async () => {
    const fake = new FakeCollection()
    const journal = makeJournal(fake, {
      resolveActivePlan: async () => {
        throw new Error('plans lookup down (simulated)')
      },
    })
    const tools = wrapToolsWithJournal(
      { bash: { execute: async () => ({ stdout: '', stderr: '', exitCode: 0 }) } },
      journal,
    )

    await (tools.bash as { execute: ToolExecute }).execute({ command: 'ls' }, execOpts)
    const intent = fake.docs.find((d) => d.type === 'tool_call_intent')!

    // Never a guessed attribution — the field is simply absent.
    expect('authorization' in (intent.payload as Record<string, unknown>)).toBe(false)
    expect(verifyConversationChain(fake.docs).ok).toBe(true)
  })

  test('bash fail-closed: journal write failure blocks execution', async () => {
    const fake = new FakeCollection()

    fake.failInserts = true
    const journal = makeJournal(fake)
    let executed = false
    const tools = wrapToolsWithJournal(
      {
        bash: {
          execute: async () => {
            executed = true

            return { stdout: '', stderr: '', exitCode: 0 }
          },
        },
      },
      journal,
    )

    await expect(
      (tools.bash as { execute: ToolExecute }).execute(
        { command: 'kubectl delete ns prod' },
        execOpts,
      ),
    ).rejects.toThrow(/fail-closed/)
    expect(executed).toBe(false)
    expect(fake.docs).toHaveLength(0)
  })

  test('approved database execution is fail-closed before the gateway runs', async () => {
    const fake = new FakeCollection()

    fake.failInserts = true
    const journal = makeJournal(fake, {
      activePlan: { planNumber: 42, approvedBy: 'reviewer' },
    })
    let executed = false
    const tools = wrapToolsWithJournal(
      {
        database_change_execute: {
          execute: async () => {
            executed = true

            return { status: 'completed' }
          },
        },
      },
      journal,
    )

    await expect(
      (tools.database_change_execute as { execute: ToolExecute }).execute(
        { connectionId: 'connection-1', planId: '42' },
        execOpts,
      ),
    ).rejects.toThrow(/fail-closed/)
    expect(executed).toBe(false)
    expect(fake.docs).toHaveLength(0)
  })

  test('all Slack outward-effect tools are fail-closed', async () => {
    for (const toolName of ['slack_react', 'slack_post']) {
      const fake = new FakeCollection()

      fake.failInserts = true
      const journal = makeJournal(fake)
      let executed = false
      const tools = wrapToolsWithJournal(
        {
          [toolName]: {
            execute: async () => {
              executed = true
            },
          },
        },
        journal,
      )

      await expect(
        (tools[toolName] as { execute: ToolExecute }).execute({ emoji: 'x' }, execOpts),
      ).rejects.toThrow(/fail-closed/)
      expect(executed).toBe(false)
    }
  })

  test('read-only tools fail open: journal outage never blocks them', async () => {
    const fake = new FakeCollection()

    fake.failInserts = true
    const journal = makeJournal(fake)
    const tools = wrapToolsWithJournal(
      {
        web_search: { execute: async () => ({ results: [] }) },
      },
      journal,
    )

    const output = await (tools.web_search as { execute: ToolExecute }).execute(
      { query: 'nuphos' },
      execOpts,
    )

    expect(output).toEqual({ results: [] })
  })

  test('secrets are redacted from the journaled intent, with an HMAC fingerprint', async () => {
    const fake = new FakeCollection()
    const journal = makeJournal(fake)
    const tools = wrapToolsWithJournal(
      { bash: { execute: async () => ({ stdout: '', stderr: '', exitCode: 0 }) } },
      journal,
    )

    await (tools.bash as { execute: ToolExecute }).execute(
      { command: 'export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCY && aws s3 ls' },
      execOpts,
    )

    const intent = fake.docs[0]!.payload as {
      inputRedacted: string
      redactionCount: number
      inputHmac?: string
      hmacKeyId?: string
    }

    expect(intent.inputRedacted).not.toContain('wJalrXUtnFEMIK7MDENGbPxRfiCY')
    expect(intent.redactionCount).toBeGreaterThan(0)
    expect(intent.inputHmac).toMatch(/^[a-f0-9]{64}$/)
    expect(intent.hmacKeyId).toBe('env-local')
  })

  test('tool failure records success:false and rethrows', async () => {
    const fake = new FakeCollection()
    const journal = makeJournal(fake)
    const tools = wrapToolsWithJournal(
      {
        bash: {
          execute: async () => {
            throw new Error('sandbox exploded')
          },
        },
      },
      journal,
    )

    await expect(
      (tools.bash as { execute: ToolExecute }).execute({ command: 'ls' }, execOpts),
    ).rejects.toThrow('sandbox exploded')
    const result = fake.docs.find((d) => d.type === 'tool_call_result')!

    expect((result.payload as { success: boolean }).success).toBe(false)
  })

  test('client-side tools (no execute) pass through unwrapped', () => {
    const journal = makeJournal(new FakeCollection())
    const clientTool = { description: 'runs on desktop' }
    const tools = wrapToolsWithJournal({ local_exec: clientTool }, journal)

    expect(tools.local_exec).toBe(clientTool)
  })
})

describe('AgentJournal transcript + turn events', () => {
  test('user/assistant messages journal content hashes and dedupe across syncs', async () => {
    const fake = new FakeCollection()
    const journal = makeJournal(fake)
    const messages = [
      { id: 'msg-1', role: 'user', parts: [{ type: 'text', text: 'restart the api pod' }] },
      { id: 'msg-2', role: 'assistant', parts: [{ type: 'text', text: 'done' }] },
    ]

    await journal.transcriptMessages(messages, 'user')
    await journal.transcriptMessages(messages, 'user')
    await journal.transcriptMessages(messages, 'assistant')

    const types = fake.docs.map((d) => d.type).sort(byCodeUnit)

    expect(types).toEqual(['assistant_message', 'user_message'])
    const userEvent = fake.docs.find((d) => d.type === 'user_message')!
    const payload = userEvent.payload as { contentHash: string; role: string }

    expect(payload.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(payload.role).toBe('user')

    // contentHot: display copy stored OUTSIDE the chain — it must hash to
    // payload.contentHash, and stripping it must not affect the chain.
    expect(userEvent.contentHot).toEqual(messages[0]!.parts as never)
    expect(sha256Hex(canonicalize(userEvent.contentHot))).toBe(payload.contentHash)
    expect(verifyConversationChain(fake.docs).ok).toBe(true)
    const { contentHot: _stripped, ...withoutHot } = userEvent

    expect(
      verifyConversationChain([withoutHot, ...fake.docs.filter((d) => d !== userEvent)]).ok,
    ).toBe(true)
  })

  test('contentHot survives a BSON round trip: undefined props and lone surrogates never diverge (ZEA-10049)', async () => {
    const fake = new FakeCollection()
    const journal = makeJournal(fake)
    // Server-built assistant parts: explicit undefined props are common, and
    // upstream .slice() truncations can cut an emoji in half. Both used to
    // make the stored copy differ from the hashed value.
    const messages = [
      {
        id: 'msg-hostile',
        role: 'assistant',
        parts: [
          {
            type: 'text',
            text: `truncated: ${'💥'.slice(0, 1)}`,
            providerMetadata: undefined,
          },
        ],
      },
    ]

    await journal.transcriptMessages(messages, 'assistant')

    const event = fake.docs.find((d) => d.type === 'assistant_message')!
    const payload = event.payload as { contentHash: string; hashAlg: string }
    // What Mongo hands back is what we stored: no undefined left to null out,
    // no lone surrogate left for the UTF-8 encoder to rewrite.
    const hotJson = JSON.stringify(event.contentHot)!

    expect(hotJson).not.toContain('providerMetadata')
    expect(hotJson.toWellFormed()).toBe(hotJson)
    // Read-side recompute (agent-journal contentMatches) over the stored copy
    // must land exactly on payload.contentHash.
    expect(payload.hashAlg).toBe('jcs')
    expect(sha256Hex(canonicalize(event.contentHot))).toBe(payload.contentHash)
    expect(verifyConversationChain(fake.docs).ok).toBe(true)
  })

  test('plan decisions land on the chain; same-instance dedupes, re-approval after retry does not (ZEA-10073)', async () => {
    const fake = new FakeCollection()
    const journal = makeJournal(fake)
    const firstAt = '2026-07-07T00:00:00.000Z'

    await journal.planDecision({ planNumber: 251, decision: 'approved', decidedAt: firstAt })
    // Re-journal of the SAME decision instance (same decidedAt) dedupes.
    await journal.planDecision({ planNumber: 251, decision: 'approved', decidedAt: firstAt })
    expect(fake.docs.filter((d) => d.type === 'user_approval')).toHaveLength(1)

    // A retry clears+re-stamps approvedAt, so re-approval is a NEW authorization.
    await journal.planDecision({
      planNumber: 251,
      decision: 'approved',
      decidedAt: '2026-07-07T01:30:00.000Z',
    })
    const approvals = fake.docs.filter((d) => d.type === 'user_approval')

    expect(approvals).toHaveLength(2)
    expect(approvals[0]!.actor.userId).toBe('user-1')
    expect((approvals[0]!.payload as { planNumber: number }).planNumber).toBe(251)
    expect(verifyConversationChain(fake.docs).ok).toBe(true)
  })

  test('turn_start / credential_grant / turn_end land in one verifiable chain', async () => {
    const fake = new FakeCollection()
    const journal = makeJournal(fake)

    await journal.turnStart({ messageCount: 3, localToolsEnabled: true })
    await journal.credentialGrant({ awsRoles: [{ id: 'role-1' }], gcpServiceAccounts: [] })
    await journal.turnEnd({ messageCount: 5 })

    expect(fake.docs.map((d) => d.type)).toEqual(['turn_start', 'credential_grant', 'turn_end'])
    expect(verifyConversationChain(fake.docs).ok).toBe(true)
  })
})

describe('extractClientToolResults', () => {
  test('extracts desktop tool outputs, ignores server tools and user messages', () => {
    const messages = [
      {
        id: 'msg-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-local_exec',
            toolCallId: 'call-9',
            state: 'output-available',
            output: { exitCode: 0 },
          },
          { type: 'tool-bash', toolCallId: 'call-8', state: 'output-available', output: {} },
          { type: 'tool-local_exec', toolCallId: 'call-7', state: 'input-available' },
          { type: 'text', text: 'ran it' },
        ],
      },
      {
        id: 'msg-2',
        role: 'user',
        parts: [{ type: 'tool-local_exec', toolCallId: 'x', state: 'output-available' }],
      },
    ]

    const results = extractClientToolResults(messages)

    expect(results).toHaveLength(1)
    expect(results[0]!.toolCallId).toBe('call-9')
    expect(results[0]!.toolName).toBe('local_exec')
  })
})

describe('summarizeCredentialAccess', () => {
  test('keeps ids, drops everything else', () => {
    const summary = summarizeCredentialAccess({
      awsRoles: [
        { id: 'role-1', secretArn: 'arn:aws:secret:...' },
        { arn: 'arn:aws:iam::1:role/x' },
      ],
      gcpServiceAccounts: [],
      selectAll: true,
    }) as Record<string, unknown>

    expect(summary.awsRoles).toEqual(['role-1', 'arn:aws:iam::1:role/x'])
    expect(summary.selectAll).toBe(true)
    expect(JSON.stringify(summary)).not.toContain('secretArn')
  })
})
