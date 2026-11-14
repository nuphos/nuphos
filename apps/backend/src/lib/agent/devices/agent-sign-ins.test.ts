import { expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import type { AgentSignIn } from './agent-registry'
import type { RemovableAgent } from './local-runtime/protocol'
import type { AgentResetResult } from './pending-resets'
import type { AgentDevice } from './store'

type Call = { op: string; filter: unknown; update: unknown; options?: unknown }

const calls: Call[] = []
let found: AgentDevice[] = []
let matched = 1
const collection = {
  updateOne: (filter: unknown, update: unknown, options?: unknown) => {
    calls.push({ op: 'updateOne', filter, update, ...(options ? { options } : {}) })

    return Promise.resolve({ matchedCount: matched })
  },
  insertOne: () => Promise.resolve({ acknowledged: true }),
  findOne: () => Promise.resolve(found[0] ?? null),
  find: () => ({ toArray: () => Promise.resolve(found) }),
}

useDb({ db: () => ({ collection: () => collection }) })

const {
  agentSignIn,
  endAgentSignIn,
  endSignInsAfter,
  endSignInsOnLeave,
  recordAccessChange,
  recordAgentSignIn,
} = await import('./agent-sign-ins')

const at = new Date('2026-11-13T00:00:00Z')
const lead: AgentSignIn = { agent: 'claude-code', userId: 'lead', teamId: 'team', at }
const device = (extra: Partial<AgentDevice> = {}): AgentDevice => ({
  userId: 'host',
  deviceId: 'box',
  label: 'Box',
  platform: 'linux',
  allowLocalExec: true,
  signIns: [lead],
  createdAt: at,
  updatedAt: at,
  ...extra,
})
const grant = (userIds: string[], managerIds: string[], everyone = false) => ({
  everyone,
  userIds,
  managerIds,
})
const entry = (
  previous: ReturnType<typeof grant> | null,
  next: ReturnType<typeof grant> | null,
  owner?: { from: string; to: string },
) => ({
  ownerUserId: 'host',
  deviceId: 'box',
  teamId: 'team',
  actorUserId: 'owner',
  actorAuthority: 'owner' as const,
  via: 'box_access' as const,
  previous,
  next,
  changedAt: at,
  ...(owner ? { owner } : {}),
})
const ended = () =>
  calls.map((call) => (call.options as { arrayFilters: Record<string, unknown>[] }).arrayFilters[0])
const endedOnly = (...agents: string[]) => [
  {
    $or: agents.map((agent) => ({ 's.agent': agent, 's.at': at })),
    's.endedAt': { $exists: false },
  },
]

let resets: { device: unknown; agent: RemovableAgent; by: unknown }[] = []
/** A host that resets each agent asked, or refuses with `refusal`. */
const reset =
  (refusal?: Error) =>
  (computer: { userId: string; deviceId: string }, agent: RemovableAgent, by: unknown) => {
    resets.push({ device: computer, agent, by })

    return refusal ? Promise.reject(refusal) : Promise.resolve<AgentResetResult>({ state: 'done' })
  }
const fresh = () => {
  calls.length = 0
  resets = []
}
const onBox = (agent: RemovableAgent, actorId: string) => ({
  device: { userId: 'host', deviceId: 'box' },
  agent,
  by: { actorId, teamId: 'team' },
})

test('a sign-in replaces the agent’s record, ended or not, unless a newer one is there', async () => {
  fresh()
  const record = (agent: { provider: 'opencode' | 'codex'; instanceId?: string }) =>
    recordAgentSignIn({ userId: 'host', deviceId: 'box' }, agent, {
      userId: 'lead',
      teamId: 'team',
      at,
    })

  expect(await record({ provider: 'opencode' })).toBe(true)
  const [{ filter, update }] = calls as [Call]

  expect(filter).toEqual({
    userId: 'host',
    deviceId: 'box',
    signIns: { $not: { $elemMatch: { agent: 'opencode', at: { $gt: at } } } },
  })
  // Every provider alike: OpenCode keeps no record per signer.
  expect(JSON.stringify(update)).toContain('{"$ne":["$$this.agent","opencode"]}')
  expect(JSON.stringify(update)).toContain('"agent":"opencode","userId":"lead","teamId":"team"')
  // A reset still waiting for an older host would sign this one out: older ones for it go.
  expect(JSON.stringify(update)).toContain(
    '"$eq":[{"$ifNull":["$$this.agent.instanceId","$$this.agent.provider"]},"opencode"]',
  )
  expect(JSON.stringify(update)).toContain('"$lt":["$$this.at"')
  // A late write from an older sign-in leaves the newer record alone.
  matched = 0
  expect(await record({ provider: 'codex', instanceId: 'i1' })).toBe(false)
  matched = 1
})

test('an agent has one sign-in: who it runs as, or that it ended', () => {
  expect(agentSignIn(device(), { provider: 'claude-code' })).toEqual(lead)
  expect(agentSignIn(device(), { provider: 'codex' })).toBeUndefined()
  expect(
    agentSignIn(device({ signIns: [{ ...lead, agent: 'i1', endedAt: at }] }), {
      provider: 'codex',
      instanceId: 'i1',
    })?.endedAt,
  ).toEqual(at)
})

test('anyone losing access ends every sign-in on the computer and resets its agents', async () => {
  const added: AgentSignIn = { agent: 'i1', userId: 'other', teamId: 'other-team', at }

  for (const [previous, next] of [
    [grant(['user'], ['lead']), grant([], ['lead'])],
    [grant([], [], true), grant(['user'], [])],
    [grant(['user'], []), null],
  ] as const) {
    fresh()
    await endSignInsAfter(device({ signIns: [lead, added] }), entry(previous, next), reset())
    expect(ended()).toEqual(endedOnly('claude-code', 'i1'))
    // As whoever changed the access, in the team it changed in.
    expect(resets).toEqual([
      onBox({ provider: 'claude-code' }, 'owner'),
      onBox({ instanceId: 'i1' }, 'owner'),
    ])
  }
})

test('a signer who stops managing the computer ends only their own sign-ins', async () => {
  fresh()
  await endSignInsAfter(
    device({ signIns: [lead, { agent: 'codex', userId: 'mate', teamId: 'team', at }] }),
    entry(grant(['lead', 'mate'], ['lead', 'mate']), grant(['lead', 'mate'], ['mate'])),
    reset(),
  )

  expect(ended()).toEqual(endedOnly('claude-code'))
  expect(resets).toEqual([onBox({ provider: 'claude-code' }, 'owner')])
})

test('a change that takes no access away, or a computer with no current sign-in, ends nothing', async () => {
  fresh()
  await endSignInsAfter(
    device(),
    entry(grant(['user'], ['lead']), grant(['user', 'new'], ['lead'])),
    reset(),
  )
  await endSignInsAfter(device(), entry(grant([], []), grant([], [], true)), reset())
  await endSignInsAfter(device(), entry(null, grant(['user'], [])), reset())
  // A Box changing hands keeps its sign-ins, as #2425 decided.
  await endSignInsAfter(
    device(),
    entry(grant(['user'], []), grant(['user'], []), { from: 'a', to: 'b' }),
    reset(),
  )
  await endSignInsAfter(
    device({ signIns: [{ ...lead, endedAt: at }] }),
    entry(grant(['user'], []), null),
    reset(),
  )
  await endSignInsAfter(device({ signIns: undefined }), entry(grant(['user'], []), null), reset())

  expect(calls).toEqual([])
  expect(resets).toEqual([])
})

test('a host refusing the reset never fails the access change; the sign-in still ends', async () => {
  fresh()
  await recordAccessChange(
    device(),
    entry(grant(['user'], []), null),
    reset(new Error('The host refused')),
  )

  // The agent stays blocked until a new sign-in, which resets it first.
  expect(ended()).toEqual(endedOnly('claude-code'))
  expect(resets).toHaveLength(1)
})

test('one who left the team ends the sign-ins of computers granted to everyone in it', async () => {
  fresh()
  found = [device({ signIns: [lead, { ...lead, agent: 'codex', endedAt: at }] })]
  await endSignInsOnLeave('team', { actorUserId: 'mate', via: 'team_leave' }, reset())
  found = []

  expect(ended()).toEqual(endedOnly('claude-code'))
  expect(resets).toEqual([onBox({ provider: 'claude-code' }, 'mate')])
})

test('a signer who lost managing it while signing in ends it, reset as its owner', async () => {
  fresh()
  found = [device({ box: { provider: 'k8s', teamId: 'team', createdBy: 'new-owner' } })]
  // Someone else's sign-in recorded since is theirs to keep.
  for (const userId of ['lead', 'other'])
    await endAgentSignIn(
      { userId: 'host', deviceId: 'box' },
      { provider: 'claude-code' },
      { userId, teamId: 'team' },
      reset(),
    )
  found = []

  expect(ended()).toEqual(endedOnly('claude-code'))
  // A Box handed over is reset as its new owner.
  expect(resets).toEqual([onBox({ provider: 'claude-code' }, 'new-owner')])
})
